import { createGameHttp } from './http.mjs';
import { GameError } from './store.mjs';
import { AuthError, guardOrigin } from '../auth/discord.mjs';

const MAX_BODY = 8192;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const FIELDS = new Set(['requestId', 'expectedRevision', 'action', 'actorId', 'characterVersion', 'sourceLabel', 'effectIds', 'reviewed', 'reason', 'pendingId']);
const json = (value, status = 200) => Response.json(value, { status, headers: HEADERS });
class BoundaryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const errors = {
  INVALID: [400, 'Check the concentration fields and try again.'],
  COMBAT_PROFILE: [400, 'The reviewed Constitution save needs a valid character profile.'],
  UNAUTHORIZED: [403, 'This concentration action is not available to your player.'],
  NOT_FOUND: [404, 'The host has not prepared this campaign.'],
  STALE: [409, 'The scene changed. Refresh concentration before deciding.'],
  CONFLICT: [409, 'That request already refers to another action.'],
  PAUSED: [409, 'Play is paused. Saved concentration details remain available.'],
  PENDING: [409, 'Resolve the pending interruption before starting another action.'],
  CONCENTRATION: [409, 'Refresh the pending concentration save before continuing.'],
  PROFILE: [409, 'The approved character profile changed or needs host review.'],
};
function failure(error) {
  if (error instanceof BoundaryError) return json({ error: error.message }, error.status);
  // Authentication is composed from the shared game boundary. Its internal
  // error class is intentionally not exported; disclose only fixed messages.
  if (error instanceof AuthError || error?.status === 401 || error?.status === 403) {
    const status = error.status === 401 ? 401 : 403;
    return json({ error: status === 401 ? 'Connect with a current player access code or Discord session.' : 'This request is not available to your player.' }, status);
  }
  if ((error instanceof GameError || ['INVALID', 'COMBAT_PROFILE'].includes(error?.code)) && errors[error.code]) {
    const [status, message] = errors[error.code];
    return json({ error: message, code: error.code }, status);
  }
  return json({ error: 'The concentration service could not finish this request. Retry the same saved action safely.' }, 503);
}
function sameOrigin(request) {
  if (!request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site') throw new BoundaryError(403, 'Use the concentration controls from your connected game.');
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
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !FIELDS.has(key))) throw new BoundaryError(400, 'The request contains unsupported fields.');
  return value;
}

/** Both clients use the same reviewed source, ownership and saved-roll rules. */
export function createConcentrationHttp(getServices) {
  const { authenticate } = createGameHttp(getServices);
  const route = action => async request => { try { return await action(request); } catch (error) { return failure(error); } };
  return {
    concentration: route(async request => {
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Read current concentration without extra fields.');
      return json({ concentration: game.concentration(scope) });
    }),
    resolveConcentration: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Resolve concentration without extra fields.');
      const input = await readBody(request);
      const receipt = game.resolveConcentration(scope, input);
      return json({ receipt, concentration: game.concentration(scope) });
    }),
  };
}
