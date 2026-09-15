/** Authenticated browser boundary. Campaign, owner, and scene never come from a request body. */
import { assessReach, getReachOptions } from '../game/reach.mjs';
import { GameError } from '../game/store.mjs';

const COOKIE = 'witnesslight_access';
const MAX_BODY = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { ...HEADERS, ...extra } });
}

function sameOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(403, 'Open the game directly before making this request.');
  }
}

async function body(request, allowed) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new HttpError(415, 'Send a JSON request.');
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new HttpError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request is incomplete.');
  let length = 0;
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); throw new HttpError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new HttpError(400, 'Request contains unsupported fields.');
  }
  return value;
}

function cookieToken(request) {
  const parts = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim());
  const matching = parts.filter(part => part.startsWith(`${COOKIE}=`));
  if (matching.length !== 1) return null;
  try { return decodeURIComponent(matching[0].slice(COOKIE.length + 1)); }
  catch { return null; }
}

function cookie(request, token = '') {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/api/scene-images; HttpOnly; SameSite=Strict${secure}${token ? '' : '; Max-Age=0'}`;
}

function publicScene(scene) {
  if (!scene) throw new HttpError(409, 'Your host has not shared a current view yet.');
  return {
    id: scene.id, revision: scene.revision, gameRevision: scene.gameRevision ?? null, title: scene.title, description: scene.description,
    subjects: (scene.subjects ?? []).map(subject => ({ id: subject.id, label: subject.label })),
    sourceEventId: scene.sourceEventId,
  };
}

function publicJob(job) {
  if (!job) throw new HttpError(404, 'Image request was not found.');
  return {
    id: job.id, status: job.status, title: job.title, focusLabel: job.focusLabel,
    sceneRevision: job.sceneRevision, sourceEventId: job.sourceEventId,
    message: job.message, stale: Boolean(job.stale),
  };
}

function failure(error) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof GameError) {
    const messages = {
      INVALID: [400, 'Choose your character and a visible target or map coordinate.'],
      STALE: [409, 'The map changed. Refresh distance and reach before asking again.'],
      UNAUTHORIZED: [403, 'Your host must add your character to this tactical campaign before distances can be checked.'],
      NOT_VISIBLE: [422, 'Choose a target or destination in your current visible map.'],
      NOT_FOUND: [404, 'Your host has not prepared a tactical map for this campaign yet.'],
    };
    const [status, message] = messages[error.code] ?? [503, 'Distance and reach are unavailable. Ask your host to check the tactical map.'];
    return json({ error: message, code: error.code in messages ? error.code : 'UNAVAILABLE' }, status);
  }
  // Service error details may contain private prompts, provider output, or file paths.
  const status = Number(error?.status ?? error?.statusCode);
  const messages = {
    400: 'The request could not be accepted. Refresh your view and try again.',
    401: 'Enter your player access code to connect.',
    403: 'This image is not available to your player.',
    404: 'Image request was not found.',
    409: 'Your current view or image is not ready. Refresh and try again.',
    422: 'That subject is not in your current view. Refresh and try again.',
    429: 'An image is already being prepared or the request limit was reached. Wait and try again.',
    503: 'Scene images are not available yet. Ask your host to finish image setup.',
  };
  return json({ error: messages[status] ?? 'The image service could not complete the request. Try again.' }, messages[status] ? status : 500);
}

export function createSceneImageHttp(getService, { getGame, authenticate } = {}) {
  async function accessScope(request, service) {
    // A trusted server adapter may supply an existing authenticated session.
    // No request field selects this override or supplies the resulting identity.
    if (authenticate) return authenticate(request);
    const token = cookieToken(request);
    if (!token || token.length > 1024) throw new HttpError(401, 'Enter your player access code to connect.');
    const scope = await service.authenticateAccess(token);
    if (!scope) throw new HttpError(401, 'Enter your player access code to connect.');
    return scope;
  }

  function route(action) {
    return async (...args) => {
      try { return await action(...args); }
      catch (error) { return failure(error); }
    };
  }

  return {
    reachOptions: route(async request => {
      const service = await getService();
      const scope = await accessScope(request, service);
      if (new URL(request.url).search) throw new HttpError(400, 'Open distance and reach without extra fields.');
      if (!getGame) throw new HttpError(503, 'Distances need a prepared tactical map and character from your host.');
      return json({ options: getReachOptions(await getGame(), scope) });
    }),
    reach: route(async request => {
      sameOrigin(request);
      const service = await getService();
      const scope = await accessScope(request, service);
      const input = await body(request, ['expectedRevision', 'actorId', 'targetId', 'coordinate']);
      if (!getGame) throw new HttpError(503, 'Distances need a prepared tactical map and character from your host.');
      return json({ result: assessReach(await getGame(), scope, input) });
    }),
    connect: route(async request => {
      sameOrigin(request);
      const { token } = await body(request, ['token']);
      if (typeof token !== 'string' || token.length < 16 || token.length > 1024 || /\s/.test(token)) {
        throw new HttpError(401, 'Enter a valid player access code.');
      }
      const service = await getService();
      const scope = await service.authenticateAccess(token);
      if (!scope) throw new HttpError(401, 'Enter a valid player access code.');
      return json({ connected: true }, 200, { 'Set-Cookie': cookie(request, token) });
    }),
    disconnect: route(async request => {
      sameOrigin(request);
      return json({ connected: false }, 200, { 'Set-Cookie': cookie(request) });
    }),
    scene: route(async request => {
      const service = await getService();
      const scope = await accessScope(request, service);
      return json({ scene: publicScene(await service.scene(scope)) });
    }),
    history: route(async request => {
      const service = await getService();
      const scope = await accessScope(request, service);
      if (new URL(request.url).search) throw new HttpError(400, 'Open image history without extra fields.');
      return json({ images: service.history(scope) });
    }),
    requestImage: route(async request => {
      sameOrigin(request);
      const service = await getService();
      const scope = await accessScope(request, service);
      const { requestId, focusId } = await body(request, ['requestId', 'focusId']);
      if (typeof requestId !== 'string' || !UUID.test(requestId) || typeof focusId !== 'string' || !ID.test(focusId)) {
        throw new HttpError(400, 'Choose a visible subject and try again.');
      }
      return json({ job: publicJob(await service.requestImage(scope, { requestId, focusId })) }, 202);
    }),
    job: route(async (request, id) => {
      const service = await getService();
      const scope = await accessScope(request, service);
      if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(404, 'Image request was not found.');
      return json({ job: publicJob(await service.getJob(scope, id)) });
    }),
    image: route(async (request, id) => {
      const service = await getService();
      const scope = await accessScope(request, service);
      if (typeof id !== 'string' || !ID.test(id)) throw new HttpError(404, 'Image request was not found.');
      const job = await service.getJob(scope, id);
      if (!job) throw new HttpError(404, 'Image request was not found.');
      if (job.status !== 'ready') throw new HttpError(409, 'This image is still being prepared.');
      const result = await service.image(scope, id);
      if (result.mimeType !== 'image/png') throw new HttpError(500, 'The image could not be displayed.');
      return new Response(new Uint8Array(result.bytes), { headers: {
        ...HEADERS, 'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="witnesslight-${id}.png"`,
        'Cross-Origin-Resource-Policy': 'same-origin',
      } });
    }),
  };
}
