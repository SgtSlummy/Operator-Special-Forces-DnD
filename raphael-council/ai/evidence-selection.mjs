import { createHash } from 'node:crypto';
import { prepareEvidenceProjection } from './host-control.mjs';
import { canonicalEvidence } from './evidence-upload.mjs';

export const SELECTION_CONTRACT = 'raph-obus-game-evidence-refs-v2';
const STAMP_CONTRACT = 'raph-obus-game-selection-v1';
const integer = value => Number.isSafeInteger(value) && value >= 0;
function invalid() {
  throw Object.assign(new Error('Invalid or changed Obus evidence selection.'), { code: 'INVALID_EVIDENCE_SELECTION', status: 409 });
}
function compare(left, right) {
  const a = Array.from(left, value => value.codePointAt(0)), b = Array.from(right, value => value.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function normalizedSource(source) {
  return { ...source, contributors: [...source.contributors].sort((a, b) => compare(a.user, b.user)),
    derivesFrom: [...source.derivesFrom].sort((a, b) => compare(a.ref, b.ref)) };
}
function references(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 32 || Reflect.ownKeys(input).length !== input.length + 1) invalid();
  const result = [], seen = new Set();
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    const value = descriptor.value;
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || keys.some(key => !['ref', 'revision'].includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) invalid();
    if (typeof value.ref !== 'string' || !value.ref || value.ref.length > 160 || !value.ref.isWellFormed() || !integer(value.revision) || seen.has(value.ref)) invalid();
    seen.add(value.ref);
    result.push(Object.freeze({ ref: value.ref, revision: value.revision }));
  }
  return Object.freeze(result.sort((a, b) => compare(a.ref, b.ref)));
}

/** Capture consistency, never authority. Obus independently resolves scope/ACL/consent. */
export function captureEvidenceSelection(input, requested) {
  const projection = prepareEvidenceProjection(input), refs = references(requested);
  const sources = new Map(projection.sources.map(source => [source.ref, source]));
  const selected = new Map(), visiting = new Set();
  let textSize = 0;
  function visit(reference) {
    const source = sources.get(reference.ref);
    if (!source || source.deleted || source.revision !== reference.revision || visiting.has(source.ref)) invalid();
    if (selected.has(source.ref)) return;
    if (selected.size + visiting.size >= 32) invalid();
    visiting.add(source.ref);
    textSize += Array.from(source.text).length;
    if (textSize > 16000) invalid();
    for (const dependency of source.derivesFrom) visit(dependency);
    visiting.delete(source.ref);
    selected.set(source.ref, normalizedSource(source));
  }
  refs.forEach(visit);
  const closure = [...selected.values()].sort((a, b) => compare(a.ref, b.ref));
  const users = [...new Set(closure.flatMap(source => source.contributors.map(item => item.user)))].sort(compare);
  const participants = new Map(projection.participants.map(item => [item.user, item]));
  const stamp = { contract: STAMP_CONTRACT, campaign: projection.campaign, session: projection.session, sources: closure,
    participants: users.map(user => ({ user, state: participants.get(user) ?? null })) };
  const selectionHash = createHash('sha256').update(canonicalEvidence(stamp), 'utf8').digest('hex');
  return Object.freeze({ evidence: Object.freeze({ contract: SELECTION_CONTRACT, revision: projection.revision, selectionHash, references: refs }),
    references: Object.freeze(closure.map(source => Object.freeze({ ref: source.ref, revision: source.revision }))) });
}

/** Both inputs must be immutable documents from the shared evidence preparer. */
export function isEvidenceAppend(previous, current) {
  if (previous.contract !== current.contract || previous.campaign !== current.campaign || previous.session !== current.session || current.revision < previous.revision) return false;
  const participants = new Map(current.participants.map(item => [item.user, item]));
  const sources = new Map(current.sources.map(item => [item.ref, item]));
  if (previous.participants.some(item => canonicalEvidence(item) !== canonicalEvidence(participants.get(item.user)))) return false;
  if (previous.sources.some(item => !sources.has(item.ref) || canonicalEvidence(normalizedSource(item)) !== canonicalEvidence(normalizedSource(sources.get(item.ref))))) return false;
  // A producer must advance its revision for additions; identical revisions
  // cannot conceal unversioned mutations even if the old rows still exist.
  return current.revision > previous.revision || (current.sources.length === previous.sources.length && current.participants.length === previous.participants.length);
}
