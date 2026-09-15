import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const fields = { command: 'registeredCommandId', lobby: 'lobbyMessageId' };
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const fail = code => { const error = new Error(code); error.code = code; throw error; };

/** One running gateway owns this file. Writes are serialized and atomically replaced.
 * Begin BEFORE the Discord POST; complete only after a confirmed result. A failed
 * POST or failed local completion retains the marker, requiring explicit recovery.
 * verify callbacks must fetch fresh Discord records; booleans are never accepted.
 */
export async function createPresentationState({ file, campaignId, guildId, channelId, applicationId }) {
  if (!file || !campaignId || ![guildId, channelId, applicationId].every(snowflake)) fail('PRESENTATION_SCOPE_REQUIRED');
  const scope = { campaignId, guildId, channelId, applicationId };
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const validate = value => {
    if (!value || value.version !== 1 || Object.entries(scope).some(([key, expected]) => value[key] !== expected)) fail('PRESENTATION_SCOPE_MISMATCH');
    if (!value.pending || typeof value.pending !== 'object' || Array.isArray(value.pending)) fail('PRESENTATION_STATE_INVALID');
    for (const [kind, field] of Object.entries(fields)) {
      if (value[field] !== null && !snowflake(value[field])) fail('PRESENTATION_STATE_INVALID');
      const pending = value.pending[kind];
      if (pending && (typeof pending.operationId !== 'string' || !pending.operationId || typeof pending.startedAt !== 'string')) fail('PRESENTATION_STATE_INVALID');
    }
    if (Object.keys(value.pending).some(key => !fields[key])) fail('PRESENTATION_STATE_INVALID');
  };
  async function persist(next) {
    validate(next);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(next, null, 2));
      await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, file);
      state = next;
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  if (state) validate(state);
  else await persist({ version: 1, ...scope, registeredCommandId: null, lobbyMessageId: null, pending: {} });
  let queue = Promise.resolve();
  const serial = callback => { const result = queue.then(callback); queue = result.catch(() => {}); return result; };
  const fieldFor = kind => fields[kind] ?? fail('PRESENTATION_KIND_INVALID');
  async function verifyRecord(kind, id, verify) {
    if (!snowflake(id) || typeof verify !== 'function') fail('PRESENTATION_VERIFICATION_REQUIRED');
    const record = await verify({ kind, id, ...scope });
    const valid = kind === 'command'
      ? record?.id === id && record.application_id === applicationId && record.guild_id === guildId && record.name === 'hollow-lantern' && record.type === 1
      : record?.id === id && (record.channel_id ?? record.channelId) === channelId && record.author?.id === applicationId && record.webhook_id == null;
    if (!valid) fail('PRESENTATION_OWNER_MISMATCH');
    return record;
  }
  return Object.freeze({
    read: () => structuredClone(state),
    beginSend(kind) { return serial(async () => {
      const field = fieldFor(kind);
      if (state.pending[kind]) fail('PRESENTATION_DELIVERY_UNCERTAIN');
      if (state[field]) fail('PRESENTATION_ALREADY_REGISTERED');
      const operationId = randomUUID(), next = structuredClone(state);
      next.pending[kind] = { operationId, startedAt: new Date().toISOString() };
      await persist(next); return operationId;
    }); },
    completeSend(kind, { operationId, id }) { return serial(async () => {
      const field = fieldFor(kind);
      if (!snowflake(id) || state.pending[kind]?.operationId !== operationId) fail('PRESENTATION_OPERATION_MISMATCH');
      const next = structuredClone(state); next[field] = id; delete next.pending[kind];
      await persist(next); return structuredClone(next);
    }); },
    verifyExisting(kind, verify) { return serial(async () => {
      const field = fieldFor(kind);
      if (state.pending[kind]) fail('PRESENTATION_DELIVERY_UNCERTAIN');
      return state[field] ? verifyRecord(kind, state[field], verify) : null;
    }); },
    recover(kind, { id, verify }) { return serial(async () => {
      const field = fieldFor(kind);
      if (state[field] && state[field] !== id) fail('PRESENTATION_ALREADY_REGISTERED');
      await verifyRecord(kind, id, verify);
      const next = structuredClone(state); next[field] = id; delete next.pending[kind];
      await persist(next); return structuredClone(next);
    }); },
  });
}
