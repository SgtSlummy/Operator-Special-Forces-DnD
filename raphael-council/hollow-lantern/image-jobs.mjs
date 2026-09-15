import { randomUUID, createHash } from 'node:crypto';
import { loadImage } from '@napi-rs/canvas';

const CONTRACT = 'raph-obus-game-image-v1';
const sameScope = (a, b) => ['campaign', 'owner', 'audience', 'characterId', 'sceneId', 'revision'].every(key => a?.[key] === b?.[key]);
const identity = scope => JSON.stringify([scope.campaign, scope.owner, scope.audience, scope.characterId]);
const retained = reason => ({ status: 'retained', reason });
async function boundedJson(response) {
  if (!response.ok) throw new Error('image_unavailable');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8 * 1024 * 1024) throw new Error('image_too_large'); chunks.push(Buffer.from(value)); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Caller supplies trusted prepare(scope), which returns ONLY audience-filtered approved art
 * {approved:true,prompt,negativePrompt?,seed?}. No map geometry or raw GM projection is accepted.
 * current(scope) returns current {sceneId,revision}; authorize(scope) rechecks ownership.
 * commit({scope,image,receipt}) MUST atomically compare scene/revision before replacing art,
 * returning true only if installed. Existing artwork is otherwise retained.
 * hostHeaders(body) signs this exact request with the existing Obus host-control authority.
 */
export function createImageJobs({ baseUrl = 'http://127.0.0.1:38176', token, hostHeaders, authorize, current, prepare, commit,
  hasPendingGameplay = () => false, fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error('Image service must use its private loopback endpoint.');
  if (![hostHeaders, authorize, current, prepare, commit, fetchImpl].every(value => typeof value === 'function') || typeof token !== 'string' || !token) throw new Error('Scoped image authorization and delivery callbacks are required.');
  let active = false;
  const generations = new Map();
  async function request({ scope, session, runtime, requestId = randomUUID() }) {
    const valid = scope && ['campaign', 'owner', 'sceneId'].every(k => typeof scope[k] === 'string' && scope[k].length > 0 && scope[k].length <= 100)
      && ['public', 'private', 'gm'].includes(scope.audience) && typeof scope.characterId === 'string'
      && (scope.audience !== 'private' || scope.characterId.length > 0) && (scope.audience !== 'public' || scope.characterId === '')
      && Number.isSafeInteger(scope.revision) && scope.revision >= 0;
    if (!valid) return retained('invalid-scope');
    const key = identity(scope), generation = (generations.get(key) ?? 0) + 1; generations.set(key, generation);
    if (active) return retained('gameplay-priority');
    active = true;
    try {
      if (await hasPendingGameplay()) return retained('gameplay-priority');
      const stillCurrent = async () => { const snapshot = await current(scope); return snapshot?.revision === scope.revision && snapshot?.sceneId === scope.sceneId && generations.get(key) === generation; };
      if (!await authorize(scope) || !await stillCurrent()) return retained('scope-changed');
      const art = await prepare(scope);
      if (art?.approved !== true || typeof art.prompt !== 'string' || !art.prompt.trim() || art.prompt.length > 1600) return retained('unapproved-art');
      if (await hasPendingGameplay() || !await authorize(scope) || !await stillCurrent()) return retained('scope-changed');
      const body = { contract: CONTRACT, scope: { campaign: scope.campaign, owner: scope.owner, audience: scope.audience, characterId: scope.characterId, sceneId: scope.sceneId, revision: scope.revision }, session, requestId, runtime,
        prompt: art.prompt, negativePrompt: art.negativePrompt ?? '', seed: art.seed ?? -1 };
      const result = await boundedJson(await fetchImpl(`${url.origin}/api/game/images`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(135000),
        headers: { ...await hostHeaders(body), 'Content-Type': 'application/json', 'X-Obus-Game-Token': token }, body: JSON.stringify(body) }));
      if (result.contract !== CONTRACT || result.requestId !== requestId || result.status !== 'completed' || !sameScope(result.scope, scope) || result.session !== session
        || ['contract','bootEpoch','generation','sessionPolicyRevision'].some(k => result.runtime?.[k] !== runtime?.[k]) || result.mime_type !== 'image/png'
        || typeof result.image_base64 !== 'string' || result.image_base64.length > 6 * 1024 * 1024) return retained('invalid-image');
      const image = Buffer.from(result.image_base64, 'base64');
      if (image.length > 4 * 1024 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return retained('invalid-image');
      const decoded = await loadImage(image);
      if (decoded.width !== 512 || decoded.height !== 512 || createHash('sha256').update(image).digest('hex') !== result.receipt?.sha256) return retained('invalid-image');
      if (!await authorize(scope) || !await stillCurrent()) return retained('scope-changed');
      const applied = await commit({ scope: { ...scope }, image, receipt: result.receipt });
      return applied === true ? { status: 'applied', requestId, receipt: result.receipt } : retained('scope-changed');
    } catch { return retained('image-unavailable'); }
    finally { active = false; }
  }
  return Object.freeze({ request, invalidate(scope) { const key = identity(scope); generations.set(key, (generations.get(key) ?? 0) + 1); } });
}
