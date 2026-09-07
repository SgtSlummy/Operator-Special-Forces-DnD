import { createGameHttp } from './http.mjs';
import { AuthError, guardOrigin } from '../auth/discord.mjs';

// Accommodates the bounded core definition, including multibyte UTF-8 labels.
const MAX_BODY = 1048576;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const actions = { configure: 'configureWorldTime', preview: 'previewWorldTime', advance: 'advanceWorldTime', decision: 'recordWorldTimeDecision' };
const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS });
class BoundaryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const errors = {
  INVALID: [400, 'Check the reviewed world time fields and try again.'],
  UNAUTHORIZED: [403, 'Only the current host can review and change world time.'],
  NOT_FOUND: [404, 'The host has not prepared the requested world time information.'],
  STALE: [409, 'The game or calendar changed. Refresh before reviewing this interval.'],
  CONFLICT: [409, 'That request no longer matches the saved world time decision.'],
  PAUSED: [409, 'Play is paused. The saved calendar remains available.'],
  PENDING: [409, 'Resolve the pending game interruption before advancing time.'],
  WORLD_TIME: [409, 'The saved calendar needs host review before continuing.'],
  UNCONFIGURED: [409, 'The host has not configured this calendar yet.'],
  STATE: [409, 'The saved world state needs host review before continuing.'],
  REVIEW: [400, 'Review the world time decision and its required fields first.'],
  LIMIT: [400, 'The requested interval exceeds the supported world time limits.'],
  PHASE: [409, 'World time cannot advance in the current game phase.'],
};
function failure(error) {
  if (error instanceof BoundaryError) return json({ error: error.message }, error.status);
  if (error instanceof AuthError || error?.status === 401 || error?.status === 403) {
    const status = error.status === 401 ? 401 : 403;
    return json({ error: status === 401 ? 'Connect with a current player access code or Discord session.' : 'This request is not available to your player.' }, status);
  }
  if (typeof error?.code === 'string' && Object.hasOwn(errors, error.code)) {
    const [status, message] = errors[error.code];
    return json({ error: message, code: error.code }, status);
  }
  return json({ error: 'The world time service could not finish this request. Retry the same saved action safely.' }, 503);
}
function sameOrigin(request) {
  if (!request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site') throw new BoundaryError(403, 'Use the world time controls from your connected game.');
  if (request.headers.get('origin') === new URL(request.url).origin) return;
  guardOrigin(request);
}
async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new BoundaryError(415, 'Send a JSON request.');
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new BoundaryError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new BoundaryError(400, 'The request is incomplete.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new BoundaryError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BoundaryError(400, 'The request is not valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.hasOwn(value, 'action') || typeof value.action !== 'string' || !Object.hasOwn(actions, value.action)) throw new BoundaryError(400, 'Choose a supported world time action.');
  return value;
}

/** Optional browser controls use the same calendar decisions as the Discord game. */
export function createWorldTimeHttp(getServices) {
  const { authenticate } = createGameHttp(getServices);
  const route = action => async request => { try { return await action(request); } catch (error) { return failure(error); } };
  return {
    worldTime: route(async request => {
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Read current world time without extra fields.');
      return json({ time: game.worldTime(scope) });
    }),
    changeWorldTime: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Review world time without extra fields.');
      const { action, ...input } = await readBody(request);
      const result = game[actions[action]](scope, input);
      return json({ [action === 'preview' ? 'preview' : 'receipt']: result, time: game.worldTime(scope) });
    }),
  };
}
