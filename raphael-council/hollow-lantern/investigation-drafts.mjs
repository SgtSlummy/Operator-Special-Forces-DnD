import { open, mkdir, realpath, rename, unlink, readFile, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 4 * 1024 * 1024, MAX_DRAFTS = 1000;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
function scopeKey(scope) {
  if (!scope || scope.role !== 'player' || scope.visibility !== 'private' || !['campaignId','userId','actorId'].every(key => identifier(scope[key]))) fail('DRAFT_SCOPE_INVALID');
  return JSON.stringify([scope.campaignId, scope.userId, scope.actorId]);
}
function jsonCopy(value, limit = 16384) {
  const seen = new Set();
  function check(item, depth) {
    if (depth > 16) fail('DRAFT_INPUT_INVALID');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || seen.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) fail('DRAFT_INPUT_INVALID');
    seen.add(item); for (const part of Object.values(item)) check(part, depth + 1); seen.delete(item);
  }
  check(value, 0); const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > limit) fail('DRAFT_INPUT_INVALID');
  return JSON.parse(encoded);
}
function validateInput(value) {
  if (!value || !identifier(value.actionId) || !value.input || Object.getPrototypeOf(value.input) !== Object.prototype || Object.keys(value.input).length > 10 || Object.entries(value.input).some(([key, text]) => !identifier(key) || typeof text !== 'string') || Buffer.byteLength(JSON.stringify(value.input), 'utf8') > 8192 || !revision(value.expectedRevision) || !value.actionPayload || Object.getPrototypeOf(value.actionPayload) !== Object.prototype) fail('DRAFT_INPUT_INVALID');
  jsonCopy(value.actionPayload);
}
function validateState(state) {
  try {
    if (!state || state.version !== 1 || !Array.isArray(state.drafts) || state.drafts.length > MAX_DRAFTS) throw new Error();
    const keys = new Set();
    for (const draft of state.drafts) {
      const key = scopeKey(draft.scope); if (keys.has(key)) throw new Error(); keys.add(key);
      validateInput(draft);
      if (!identifier(draft.draftId) || !Number.isSafeInteger(draft.version) || draft.version < 1 || !['editing','prepared','completed'].includes(draft.status)) throw new Error();
      if (draft.status === 'editing') { if (draft.intent !== null || draft.receipt !== null) throw new Error(); }
      else {
        const intent = draft.intent;
        if (!intent || !identifier(intent.commandId) || intent.actionId !== draft.actionId || intent.expectedRevision !== draft.expectedRevision || JSON.stringify(intent.input) !== JSON.stringify(draft.input) || JSON.stringify(intent.actionPayload) !== JSON.stringify(draft.actionPayload)) throw new Error();
        if (draft.status === 'prepared' ? draft.receipt !== null : !draft.receipt || typeof draft.receipt !== 'object' || Array.isArray(draft.receipt)) throw new Error();
        if (draft.receipt) jsonCopy(draft.receipt);
      }
    }
  } catch { fail('DRAFT_STATE_INVALID'); }
}
const localPath = file => typeof file === 'string' && isAbsolute(file) && !/^[/\\]{2}/.test(file) && !/onedrive/i.test(file);
async function syncDirectory(directory) {
  let handle;
  try { handle = await open(directory, 'r'); await handle.sync(); }
  catch (error) { if (!(process.platform === 'win32' && ['EPERM','EACCES','EISDIR','EINVAL','ENOTSUP'].includes(error.code))) throw error; }
  finally { await handle?.close(); }
}

/** Host-only store: derive scope from authenticated campaign/seat access, never request JSON.
 * No engine calls occur here. Execute only the persisted intent using commandId as the
 * engine idempotency key. A prepared retry MUST reconcile that key before any new action.
 * An orphan .lock requires operator verification that its owner has stopped; never auto-clear.
 */
export async function createInvestigationDraftStore({ file, removeOwnedLock = unlink }) {
  if (typeof removeOwnedLock !== 'function') fail('DRAFT_INPUT_INVALID');
  if (!localPath(file)) fail('DRAFT_PATH_INVALID');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const directory = await realpath(dirname(file));
  if (!localPath(directory)) fail('DRAFT_PATH_INVALID');
  file = join(directory, basename(file));
  const lockPath = `${file}.lock`, lockOwner = { pid: process.pid, token: randomUUID() }; let lock, lockIdentity, closeFlight;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('DRAFT_STORE_LOCKED'); throw error; }
  let state, closed = false, faulted = false, queue = Promise.resolve();
  async function persist(next) {
    validateState(next); const bytes = JSON.stringify(next);
    if (Buffer.byteLength(bytes) > MAX_BYTES) fail('DRAFT_STORE_FULL');
    const temporary = `${file}.${randomUUID()}.tmp`; let handle;
    try {
      handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, file); await syncDirectory(directory); state = next;
    } catch (error) { faulted = true; throw error; }
    finally { await handle?.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  try {
    await lock.writeFile(JSON.stringify(lockOwner)); await lock.sync(); lockIdentity = await lock.stat();
    let existing;
    try {
      existing = await open(file, 'r');
      if ((await existing.stat()).size > MAX_BYTES) fail('DRAFT_STATE_INVALID');
      try { state = JSON.parse(await existing.readFile('utf8')); } catch { fail('DRAFT_STATE_INVALID'); }
      validateState(state);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await existing?.close(); }
    if (!state) await persist({ version: 1, drafts: [] });
  } catch (error) { await lock.close(); await unlink(lockPath); throw error; }
  const serial = callback => {
    const result = queue.then(() => { if (closed) fail('DRAFT_STORE_CLOSED'); if (faulted) fail('DRAFT_STORE_FAULTED'); return callback(); });
    queue = result.catch(() => {}); return result;
  };
  const find = scope => { const key = scopeKey(scope); return state.drafts.find(draft => scopeKey(draft.scope) === key) ?? null; };
  const replace = async draft => {
    const key = scopeKey(draft.scope), next = structuredClone(state), index = next.drafts.findIndex(item => scopeKey(item.scope) === key);
    if (index < 0) { if (next.drafts.length >= MAX_DRAFTS) fail('DRAFT_STORE_FULL'); next.drafts.push(draft); } else next.drafts[index] = draft;
    await persist(next); return structuredClone(draft);
  };
  return Object.freeze({
    get(scope) { return serial(() => structuredClone(find(scope))); },
    save(scope, value, expectedDraftVersion = null) { return serial(async () => {
      const current = find(scope); validateInput(value);
      if (current?.status === 'prepared') fail('DRAFT_PREPARED');
      if ((current?.version ?? null) !== expectedDraftVersion) fail('DRAFT_VERSION_MISMATCH');
      const draft = { scope: {campaignId:scope.campaignId,userId:scope.userId,actorId:scope.actorId,role:'player',visibility:'private'}, draftId:current?.status === 'editing' ? current.draftId : randomUUID(), version:(current?.version ?? 0)+1, status:'editing', actionId:value.actionId, actionPayload:jsonCopy(value.actionPayload), input:jsonCopy(value.input,8192), expectedRevision:value.expectedRevision, intent:null, receipt:null };
      return replace(draft);
    }); },
    prepare(scope, { draftId, version, currentRevision, availableActionIds }) { return serial(async () => {
      const draft = find(scope);
      if (!draft || draft.draftId !== draftId || draft.version !== version) fail('DRAFT_VERSION_MISMATCH');
      if (draft.status !== 'editing') return structuredClone(draft);
      if (!revision(currentRevision) || draft.expectedRevision !== currentRevision) fail('DRAFT_REVISION_MISMATCH');
      if (!Array.isArray(availableActionIds) || !availableActionIds.includes(draft.actionId)) fail('DRAFT_ACTION_UNAVAILABLE');
      return replace({...draft,status:'prepared',intent:{commandId:randomUUID(),actionId:draft.actionId,actionPayload:jsonCopy(draft.actionPayload),input:draft.input,expectedRevision:draft.expectedRevision}});
    }); },
    complete(scope, { draftId, commandId, receipt }) { return serial(async () => {
      const draft = find(scope);
      if (!draft || draft.draftId !== draftId || !draft.intent || draft.intent.commandId !== commandId) fail('DRAFT_COMMAND_MISMATCH');
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('DRAFT_INPUT_INVALID');
      const copy = jsonCopy(receipt);
      if (draft.status === 'completed') { if (JSON.stringify(copy) !== JSON.stringify(draft.receipt)) fail('DRAFT_RECEIPT_MISMATCH'); return structuredClone(draft); }
      return replace({...draft,status:'completed',receipt:copy});
    }); },
    close() {
      if (closeFlight) return closeFlight;
      closeFlight = queue.then(async () => {
        closed = true; await lock.close();
        const delays = [25, 50, 100, 200, 400];
        for (let attempt = 0; ; attempt++) {
          try {
            // Never retry against a marker replaced by another owner or operator.
            const info = await lstat(lockPath);
            if (!info.isFile() || info.isSymbolicLink() || info.dev !== lockIdentity.dev || info.ino !== lockIdentity.ino || info.size > 1024) fail('DRAFT_LOCK_OWNERSHIP_LOST');
            let owner; try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch (error) { if (error instanceof SyntaxError) fail('DRAFT_LOCK_OWNERSHIP_LOST'); throw error; }
            if (owner?.pid !== lockOwner.pid || owner?.token !== lockOwner.token) fail('DRAFT_LOCK_OWNERSHIP_LOST');
            await removeOwnedLock(lockPath); return;
          } catch (error) {
            if (!['EBUSY', 'EPERM'].includes(error.code) || attempt >= delays.length) throw error;
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
          }
        }
      });
      queue = closeFlight.catch(() => {}); return closeFlight;
    },
  });
}
