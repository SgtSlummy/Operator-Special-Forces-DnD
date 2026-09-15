import { EVIDENCE_CONTRACT, prepareEvidenceDocument, prepareEvidenceProjection, validateEvidenceReceipt } from '../ai/host-control.mjs';
import { captureEvidenceSelection, isEvidenceAppend } from '../ai/evidence-selection.mjs';

const RUNTIME_CONTRACT = 'raph-obus-game-runtime-v1';
const REFERENCES_CONTRACT = 'raph-obus-game-evidence-refs-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(code, status, message) {
  return Object.assign(new Error(message), { name: 'ObusEvidenceBridgeError', code, status });
}
function invalid() { throw failure('INVALID_EVIDENCE_INPUT', 400, 'Invalid game evidence request.'); }
function exact(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) invalid();
}
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function runtimeFence(value) {
  // Evidence writes remain available while generation is disabled. They still
  // require a known host policy, live lease and runtime fencing. Synchronizing
  // to private Obus grants neither generation nor external-dispatch authority.
  if (!value || value.contract !== RUNTIME_CONTRACT || typeof value.bootEpoch !== 'string' || !UUID.test(value.bootEpoch) ||
      typeof value.generation !== 'string' || !UUID.test(value.generation) || !integer(value.sessionPolicyRevision) ||
      !integer(value.leaseExpiresAtMs) || value.leaseExpiresAtMs <= Date.now() ||
      typeof value.effectivePolicy?.enabled !== 'boolean' || !['local', 'local-free'].includes(value.effectivePolicy.mode) ||
      value.effectivePolicy.codex !== false || typeof value.effectivePolicy.exportable !== 'boolean') {
    throw failure('EVIDENCE_RUNTIME_UNAVAILABLE', 409, 'An active Obus host lease with an allowed policy is required to synchronize evidence.');
  }
  return Object.freeze({ contract: RUNTIME_CONTRACT, bootEpoch: value.bootEpoch, generation: value.generation, sessionPolicyRevision: value.sessionPolicyRevision });
}
function changed() { throw failure('EVIDENCE_CHANGED_DURING_SYNC', 409, 'Game evidence or runtime changed during synchronization; obtain a fresh snapshot.'); }

/**
 * Trusted server composition only. `campaigns` is an explicit static allowlist
 * (array or Set, copied here). `authorizeCommand` must synchronously return true
 * for a currently authorized host, including any delegated GM policy. No role is
 * inferred from the requesting owner or from the session's original creator.
 * Store get/evidenceProjection must be synchronous authoritative reads.
 *
 * `allowStoreSync` grants the trusted server worker a separate `syncStored`
 * capability. It mirrors only the authoritative store, including consent
 * withdrawals after a GM leaves; it accepts no player-supplied projection.
 * Keep that capability private to server composition and background workers.
 * This bridge does not enable provider routes or expose an HTTP/player endpoint.
 */
export function createObusEvidenceBridge({ store, hostControl, campaigns, authorizeCommand, allowStoreSync = false } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.evidenceProjection !== 'function' || !hostControl || typeof hostControl.getRuntime !== 'function' || typeof hostControl.syncEvidence !== 'function' || typeof authorizeCommand !== 'function' || !(Array.isArray(campaigns) || campaigns instanceof Set)) invalid();
  if (campaigns.size > 256 || campaigns.length > 256 || typeof allowStoreSync !== 'boolean') invalid();
  const allowed = new Set(campaigns);
  if ([...allowed].some(campaign => typeof campaign !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(campaign))) invalid();

  function request(input, requireHost) {
    exact(input, requireHost ? ['campaign', 'session', 'owner'] : ['campaign', 'session']);
    if (typeof input.campaign !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.campaign) || typeof input.session !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.session) ||
        requireHost && (typeof input.owner !== 'string' || !input.owner || input.owner.length > 100)) invalid();
    return Object.freeze({ action: 'evidence.sync', campaign: input.campaign, session: input.session,
      ...(requireHost ? { owner: input.owner } : {}) });
  }
  function authorize(input, requireHost) {
    if (!allowed.has(input.campaign)) throw failure('EVIDENCE_ACCESS_DENIED', 403, 'Access to this campaign session is required.');
    const session = store.get(input.session);
    if (!session || session.campaign !== input.campaign || requireHost && authorizeCommand(input) !== true) throw failure('EVIDENCE_ACCESS_DENIED', 403, 'Access to this campaign session is required.');
  }
  function capture(input, runtime) {
    const projection = store.evidenceProjection(input.session);
    exact(projection, ['revision', 'participants', 'sources']);
    return prepareEvidenceDocument({ contract: EVIDENCE_CONTRACT, campaign: input.campaign, session: input.session, revision: projection.revision,
      runtime, participants: projection.participants, sources: projection.sources });
  }

  function project(input) {
    const projection = store.evidenceProjection(input.session);
    exact(projection, ['revision', 'participants', 'sources']);
    return prepareEvidenceProjection({ contract: EVIDENCE_CONTRACT, campaign: input.campaign, session: input.session,
      revision: projection.revision, participants: projection.participants, sources: projection.sources });
  }
  function captureSelection(input) {
    exact(input, ['campaign', 'session', 'owner', 'sourceRevision', 'references']);
    if (!integer(input.sourceRevision)) invalid();
    const scope = Object.freeze({ campaign: input.campaign, session: input.session, owner: input.owner });
    const authorized = request(scope, true);
    authorize(authorized, true);
    const projection = project(authorized);
    if (projection.revision !== input.sourceRevision) changed();
    const selected = captureEvidenceSelection(projection, input.references);
    const check = () => {
      authorize(authorized, true);
      const current = project(authorized);
      if (current.revision < selected.evidence.revision) changed();
      try {
        if (captureEvidenceSelection(current, selected.evidence.references).evidence.selectionHash !== selected.evidence.selectionHash) changed();
      } catch (error) {
        if (error?.code === 'INVALID_EVIDENCE_SELECTION') changed();
        throw error;
      }
    };
    return Object.freeze({ evidence: selected.evidence, references: selected.references, check,
      async sync() {
        check();
        const receipt = await synchronize(scope, true);
        check();
        if (receipt.revision < selected.evidence.revision) changed();
        return receipt;
      },
    });
  }

  async function synchronize(input, requireHost) {
    const authorized = request(input, requireHost);
    const scope = Object.freeze({ campaign: authorized.campaign, session: authorized.session });
    authorize(authorized, requireHost);
    const initial = await hostControl.getRuntime(scope);
    authorize(authorized, requireHost);
    const fence = runtimeFence(initial);
    // JSON is copied, bounded and deeply frozen before the next await. A
    // caller mutating its projection object cannot change the signed body.
    const captured = capture(authorized, fence);
    // A captured prefix may be persisted while new records arrive. Changes to
    // any existing source or consent record still abort this synchronization.
    authorize(authorized, requireHost);
    const synced = await hostControl.syncEvidence(captured, () => {
      authorize(authorized, requireHost);
      if (!isEvidenceAppend(captured, capture(authorized, fence))) changed();
    });
    authorize(authorized, requireHost);
    let receipt;
    try { receipt = validateEvidenceReceipt(synced, captured); }
    catch { throw failure('INVALID_EVIDENCE_RECEIPT', 502, 'Obus returned an invalid evidence receipt.'); }
    if (!isEvidenceAppend(captured, capture(authorized, fence))) changed();
    authorize(authorized, requireHost);
    const current = await hostControl.getRuntime(scope);
    authorize(authorized, requireHost);
    if (JSON.stringify(runtimeFence(current)) !== JSON.stringify(fence)) changed();
    if (!isEvidenceAppend(captured, capture(authorized, fence))) changed();
    authorize(authorized, requireHost);
    return receipt;
  }
  return Object.freeze({
    sync: input => synchronize(input, true),
    // Private synchronous capability; capture before any authorization/network await.
    captureSelection,
    // A private server worker can mirror only this store's current projection.
    // It accepts no user identity, text, consent flags or caller-owned snapshot,
    // and returns a bounded persistence receipt without invoking any model.
    ...(allowStoreSync ? { syncStored: input => synchronize(input, false) } : {}),
  });
}

/**
 * Build references only, with no inline text or inferred source revisions.
 * A structurally valid receipt is not authorization: the backend resolves every
 * reference against its signed current snapshot, runtime, consent and ACLs.
 */
export function evidenceReferences(receipt, references) {
  const checked = validateEvidenceReceipt(receipt);
  if (!Array.isArray(references) || references.length > 32 || references.length > checked.sourceCount || Reflect.ownKeys(references).length !== references.length + 1) invalid();
  const refs = [], seen = new Set();
  for (let index = 0; index < references.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(references, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    const item = descriptor.value;
    exact(item, ['ref', 'revision']);
    if (typeof item.ref !== 'string' || !item.ref || item.ref.length > 160 || !integer(item.revision) || seen.has(item.ref)) invalid();
    seen.add(item.ref);
    refs.push(Object.freeze({ ref: item.ref, revision: item.revision }));
  }
  return Object.freeze({ contract: REFERENCES_CONTRACT, revision: checked.revision, references: Object.freeze(refs) });
}
