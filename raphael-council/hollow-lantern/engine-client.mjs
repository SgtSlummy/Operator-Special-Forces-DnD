import { createHmac } from 'node:crypto';

export const CONTRACT = 'rpg-core-runtime-bridge-v1';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_GM_PROJECTION_BYTES = 16 * 1024 * 1024;
const audiences = new Set(['public', 'private', 'gm']);
const levels = new Set(['tactical', 'dungeon', 'regional']);
const identifier = (value, name) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new EngineError('INVALID_REQUEST', `${name} is invalid.`, 400);
  return value;
};
const revision = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new EngineError('INVALID_REVISION', 'Refresh this view before acting.', 400);
  return value;
};
export class EngineError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'EngineError'; this.code = code; this.status = status; }
}

async function readJson(response, maxBytes = MAX_BYTES) {
  if (!response.body || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new EngineError('INVALID_RESPONSE', 'The game engine returned an unreadable response.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new EngineError('RESPONSE_TOO_LARGE', 'The game view exceeded its safe size.');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError('INVALID_RESPONSE', 'The game engine returned an unreadable response.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** A transport only: no game store, fallback rules, or automatic command retries. */
export function createEngineClient({ baseUrl = 'http://127.0.0.1:18791', campaignId = 'operation-hollow-lantern', channelId,
  secret, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000 } = {}) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new EngineError('UNSAFE_ENDPOINT', 'The game engine must use its private loopback endpoint.', 500);
  }
  identifier(campaignId, 'Campaign'); identifier(channelId, 'Channel');
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) throw new EngineError('MISSING_SECRET', 'The dedicated engine credential is not configured.', 500);
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new EngineError('INVALID_CONFIGURATION', 'The engine transport is not configured.', 500);

  async function request(path, input, commandId) {
    const body = JSON.stringify({ contract: CONTRACT, campaignId, channelId, ...input });
    if (Buffer.byteLength(body) > 128 * 1024) throw new EngineError('REQUEST_TOO_LARGE', 'This action is too large.', 400);
    const timestamp = now();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    let response;
    try {
      response = await fetchImpl(`${url.origin}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'x-rpg-core-contract': CONTRACT, 'x-rpg-core-timestamp': String(timestamp), 'x-rpg-core-signature': signature }, body });
    } catch { throw new EngineError('ENGINE_UNAVAILABLE', 'The game engine is unavailable. Your action was not automatically retried.', 503); }
    // The request scope sets the bound; a response cannot promote itself to GM.
    const maxBytes = path === '/api/rpg/projection' && input.audience === 'gm' ? MAX_GM_PROJECTION_BYTES : MAX_BYTES;
    const value = await readJson(response, maxBytes);
    if (!response.ok) throw new EngineError(typeof value.code === 'string' ? value.code : 'ACTION_REJECTED',
      typeof value.message === 'string' ? value.message.slice(0,300) : 'The game could not accept that action.', response.status);
    if (value.contract !== CONTRACT || value.campaignId !== campaignId || (commandId && value.commandId !== commandId)) throw new EngineError('WRONG_RESPONSE', 'The game response did not match this request.');
    revision(value.revision);
    return value;
  }

  return Object.freeze({ campaignId, channelId,
    async recovery({ownerId,operation='status',expectedRevision,authorityEpoch}) {
      identifier(ownerId,'GM');
      if(!['status','release'].includes(operation))throw new EngineError('INVALID_REQUEST','Unknown recovery operation.',400);
      const input={ownerId,operation};
      if(operation==='release'){input.expectedRevision=revision(expectedRevision);input.expectedAuthorityEpoch=revision(authorityEpoch);}
      const value=await request('/api/rpg/recovery',input);
      if(typeof value.held!=='boolean'||!Number.isSafeInteger(value.authorityEpoch)||value.authorityEpoch<0||operation==='release'&&(value.held||value.revision!==expectedRevision||value.authorityEpoch!==authorityEpoch))throw new EngineError('WRONG_RESPONSE','Recovery gate was not confirmed.');
      return value;
    },
    async command({ ownerId, actorId = '', commandId, expectedRevision, type, payload = {}, authorityEpoch }) {
      identifier(ownerId, 'Player'); identifier(commandId, 'Action'); identifier(type, 'Action type');
      if (actorId) identifier(actorId, 'Character'); revision(expectedRevision);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new EngineError('INVALID_REQUEST', 'Action details are invalid.', 400);
      const authority = authorityEpoch === undefined ? {} : { authorityEpoch: revision(authorityEpoch) };
      return request('/api/rpg/command', { ownerId, actorId, commandId, expectedRevision, type, payload, ...authority }, commandId);
    },
    async receipt({ownerId,actorId='',commandId}) {
      identifier(ownerId,'Player');identifier(commandId,'Action');if(actorId)identifier(actorId,'Character');
      const value=await request('/api/rpg/receipt',{ownerId,actorId,commandId},commandId);
      if(value.replayed!==true||value.success!==true)throw new EngineError('WRONG_RESPONSE','The recovered result is invalid.');
      return value;
    },
    async resolveUncertain({ownerId,actorId='',commandId,expectedRevision,targetOwnerId}) {
      identifier(ownerId,'Player'); identifier(commandId,'Action');
      if(typeof actorId!=='string') throw new EngineError('INVALID_REQUEST','Character is invalid.',400);
      if(actorId) identifier(actorId,'Character');
      revision(expectedRevision);
      if(expectedRevision===Number.MAX_SAFE_INTEGER) throw new EngineError('INVALID_REVISION','The original revision is out of range.',400);
      if(targetOwnerId!==undefined) identifier(targetOwnerId,'Original controller');
      const owner=targetOwnerId??ownerId;
      const value=await request('/api/rpg/resolve',{ownerId,actorId,commandId,expectedRevision,...(targetOwnerId===undefined?{}:{targetOwnerId})},commandId);
      const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
      const keys=(v,allowed)=>object(v)&&Object.keys(v).length===allowed.length&&allowed.every(key=>Object.hasOwn(v,key));
      const invalid=()=>{throw new EngineError('WRONG_RESPONSE','The recovery proof did not match the original action.');};
      const common=['contract','campaignId','commandId','ownerId','actorId','originalExpectedRevision','revision','success','replayed','resolution'];
      if(value.ownerId!==owner||value.actorId!==actorId||value.originalExpectedRevision!==expectedRevision||value.success!==true||typeof value.replayed!=='boolean') invalid();
      if(value.resolution==='committed'){
        const receipt=value.receipt;
        if(!keys(value,[...common,'receipt'])||value.replayed!==true||value.revision!==expectedRevision+1||!keys(receipt,['contract','campaignId','commandId','revision','success','replayed','result'])||receipt.contract!==CONTRACT||receipt.campaignId!==campaignId||receipt.commandId!==commandId||receipt.revision!==value.revision||receipt.success!==true||receipt.replayed!==true||!object(receipt.result)) invalid();
      }else if(value.resolution==='cancelled'){
        const proof=value.rejection;
        if(!keys(value,[...common,'rejection'])||value.revision<=expectedRevision||!keys(proof,['contract','code','terminal','campaignId','commandId','ownerId','actorId','originalExpectedRevision','revision'])||proof.contract!==CONTRACT||proof.code!=='COMMAND_CANCELLED'||proof.terminal!==true||proof.campaignId!==campaignId||proof.commandId!==commandId||proof.ownerId!==owner||proof.actorId!==actorId||proof.originalExpectedRevision!==expectedRevision||proof.revision!==value.revision) invalid();
      }else invalid();
      return structuredClone(value);
    },
    async project({ ownerId, actorId = '', audience = 'private', mapLevel = 'tactical' }) {
      identifier(ownerId, 'Player'); if (actorId) identifier(actorId, 'Character');
      if (!audiences.has(audience) || !levels.has(mapLevel) || (audience === 'private' && !actorId)) throw new EngineError('INVALID_SCOPE', 'Choose a character and map view first.', 400);
      const result = await request('/api/rpg/projection', { ownerId, characterId: actorId, audience, mapLevel });
      const view = result.projection;
      if (!view || view.projectionVersion !== 2 || view.campaignId !== campaignId || view.revision !== result.revision || view.audience !== audience || (audience === 'private' && view.characterId !== actorId)) {
        throw new EngineError('WRONG_VIEW', 'The game returned a view for a different audience.');
      }
      // A transport guard is not a replacement for the authoritative projector.
      if (audience === 'public' && ((view.characterId != null && view.characterId !== '') || ['inventory','pendingActions','privateEvents','privateHistory','gmNotes','aiDirectorId'].some(key => Object.hasOwn(view, key) && view[key] != null && (!Array.isArray(view[key]) || view[key].length)))) {
        throw new EngineError('PRIVATE_PUBLIC_VIEW', 'The public game view failed its privacy check.');
      }
      return structuredClone(view);
    },
  });
}
