import { GameError } from './store.mjs';
import { renderTacticalMap } from '../maps/render.mjs';
import { assessReach, getReachOptions } from './reach.mjs';
import { createSceneImageHttp } from '../images/http.mjs';
import { getCharacterInfo, getCharacterOptions } from './character-info.mjs';
import { getCheckRequestOptions } from './check-authoring.mjs';
import { WorldError } from './world.mjs';
import { AuthError, guardOrigin } from '../auth/discord.mjs';

const COOKIE = 'raph_game_access';
const MAX_BODY = 8192;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
class BoundaryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...HEADERS, ...extra } });
function sameOrigin(request) {
  if (request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site') return;
  guardOrigin(request);
}
function tokenFromCookie(request) {
  const matches = (request.headers.get('cookie') || '').split(';').map(p => p.trim()).filter(p => p.startsWith(COOKIE + '='));
  if (matches.length !== 1) throw new BoundaryError(401, 'Connect with your player access code.');
  let token;
  try { token = decodeURIComponent(matches[0].slice(COOKIE.length + 1)); } catch { /* Fail closed below. */ }
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new BoundaryError(401, 'Connect with your player access code.');
  return token;
}
function cookie(request, token = '') {
  return `${COOKIE}=${token}; Path=/api/game; HttpOnly; SameSite=Strict${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}${token ? '' : '; Max-Age=0'}`;
}
async function readBody(request, allowed) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new BoundaryError(415, 'Send a JSON request.');
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new BoundaryError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new BoundaryError(400, 'The request is incomplete.');
  let size = 0;
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new BoundaryError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BoundaryError(400, 'The request is not valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !allowed.includes(k))) throw new BoundaryError(400, 'The request contains unsupported fields.');
  return value;
}
const errors = {
  UNAUTHORIZED: [403, 'This campaign action is not available to your player.'], NOT_FOUND: [404, 'The host has not prepared this campaign.'],
  STALE: [409, 'The scene changed. Refresh before choosing another action.'], CONFLICT: [409, 'That request already refers to another action.'],
  TURN: [409, 'Wait for your character’s turn.'], PAUSED: [409, 'Play is paused. You can still view the map.'], PHASE: [409, 'That action is unavailable in the current phase.'],
  DEFEATED: [409, 'This character cannot act.'], RESOURCE: [409, 'That resource has already been spent.'],
  PENDING: [409, 'Resolve the pending reactions before continuing this action.'], REACTION: [409, 'That reaction is no longer available. Refresh the pending reactions.'],
  MOVEMENT: [422, 'That path is blocked or exceeds remaining movement.'], RANGE: [422, 'Choose a visible target within range.'],
  NOT_VISIBLE: [422, 'Choose a visible destination or target.'], TARGET: [422, 'Choose another active target.'],
  INVALID: [400, 'Check the action fields and try again.'], UNSUPPORTED: [422, 'That mechanic is not supported by this encounter yet.'],
  PROFILE: [409, 'The approved character profile changed or needs review. Ask the host to confirm it.'],
};
function failure(error) {
  if (error instanceof AuthError) return json({ error: error.message }, error.status);
  if (error instanceof WorldError) return json({ error: error.message, code: error.code }, error.code === 'CONFLICT' ? 409 : 400);
  if (error instanceof BoundaryError) return json({ error: error.message }, error.status);
  if (error instanceof GameError && errors[error.code]) { const [status, message] = errors[error.code]; return json({ error: message, code: error.code }, status); }
  return json({ error: 'The game service could not finish this request. Your saved action can be retried safely.' }, 503);
}

import { missionAdjudication } from './adjudication.mjs';

/** Identity, approved profiles, rolled die values and resource state are never client overrides.
 * Hosts may submit reviewed check mechanics; the shared engine validates their applicability. */
export function createGameHttp(getServices, { render = renderTacticalMap, getCharacters = () => null } = {}) {
  const route = action => async request => { try { return await action(request); } catch (error) { return failure(error); } };
  async function authenticate(request, suppliedToken) {
    const { access, game, auth } = await getServices();
    if (!suppliedToken && auth) { const scope = await auth.authenticate(request); if (scope) return { game, scope }; }
    const token = suppliedToken ?? tokenFromCookie(request);
    let scope;
    try { scope = await access.authenticateAccess(token); } catch { throw new BoundaryError(401, 'Your player access code has expired or been revoked.'); }
    if (!scope) throw new BoundaryError(401, 'Connect with your player access code.');
    game.member(scope);
    return { game, scope };
  }
  const images = createSceneImageHttp(async () => (await getServices()).access, {
    authenticate: async request => (await authenticate(request)).scope,
  });
  return {
    // Internal server composition hook; no route exposes identity overrides.
    authenticate,
    reactions: route(async request => {
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Open the current reactions without extra fields.');
      return json({ reactions: game.reactions(scope) });
    }),
    resolveReaction: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Resolve the current reaction without extra fields.');
      const input = await readBody(request, ['requestId', 'expectedRevision', 'pendingId', 'decision', 'optionId', 'order']);
      const receipt = game.resolveReaction(scope, input);
      return json({ receipt, reactions: game.reactions(scope) });
    }),
    checks: route(async request => {
      const { game, scope } = await authenticate(request);
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(k => k !== 'before') || params.getAll('before').length > 1 || (params.has('before') && !/^[1-9][0-9]{0,14}$/.test(params.get('before')))) throw new BoundaryError(400, 'Use one positive roll revision cursor.');
      return json({ pending: game.pendingChecks(scope), ...game.rollHistory(scope, params.has('before') ? Number(params.get('before')) : undefined) });
    }),
    checkRequestOptions: route(async request => {
      const { game, scope } = await authenticate(request);
      if (game.member(scope) !== 'host') throw new BoundaryError(403, 'Only the host can prepare a reviewed check.');
      if (new URL(request.url).search) throw new BoundaryError(400, 'Read current check options without extra query fields.');
      return json({ options: getCheckRequestOptions(game, await getCharacters(), scope) });
    }),
    requestCheck: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      if (game.member(scope) !== 'host') throw new BoundaryError(403, 'Only the host can prepare a reviewed check.');
      if (new URL(request.url).search) throw new BoundaryError(400, 'Prepare the check without extra query fields.');
      const input = await readBody(request, ['id', 'reviewed', 'expectedRevision', 'actorId', 'label', 'kind', 'ability', 'proficiencyMultiplier', 'proficiencyReason', 'advantage', 'disadvantage', 'adjustments', 'dc', 'cost', 'consequence']);
      return json({ check: game.requestCheck(await getCharacters(), scope, input) });
    }),
    resolveCheck: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      const input = await readBody(request, ['checkId', 'requestId']);
      return json({ receipt: game.resolveCheck(scope, input), view: game.view(scope) });
    }),
    adjudication: route(async request => {
      const { game, scope } = await authenticate(request);
      if (game.member(scope) !== 'host') throw new BoundaryError(403, 'Only the host can review mission outcomes.');
      if (new URL(request.url).search) throw new BoundaryError(400, 'Review the current mission without extra fields.');
      return json({ adjudication: missionAdjudication(game, scope) });
    }),
    adjudicateMission: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      if (game.member(scope) !== 'host') throw new BoundaryError(403, 'Only the host can record a mission outcome.');
      const input = await readBody(request, ['reviewed', 'requestId', 'expectedRevision', 'expectedWorldRevision', 'outcomeId']);
      return json({ receipt: game.adjudicateMission(scope, input) });
    }),
    departure: route(async request => { const { game, scope } = await authenticate(request); return json({ departure: game.departure(scope) }); }),
    enterDeparture: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      const input = await readBody(request, ['departureId', 'requestId']);
      return json({ receipt: game.enterDeparture(scope, input), view: game.view(scope), world: game.world(scope) });
    }),
    aiStatus: route(async request => {
      const { game, scope } = await authenticate(request), { ai } = await getServices();
      const role = game.member(scope);
      const status = await ai.status({ ...scope, role }, 'campaign');
      game.member(scope);
      return json({ role, jobs: ai.jobs(scope), ...status });
    }),
    aiConfigure: route(async request => {
      sameOrigin(request); const { game, scope } = await authenticate(request), { ai } = await getServices();
      const input = await readBody(request, ['mode', 'codex', 'enabled', 'requestId', 'expectedBootEpoch', 'expectedGeneration', 'expectedSessionPolicyRevision']);
      if (game.member(scope) !== 'host') throw new BoundaryError(403, 'Only the GM can change AI settings.');
      try {
        const policy = await ai.configure({ ...scope, role: 'host' }, 'campaign', input);
        if (game.member(scope) !== 'host') throw new BoundaryError(403, 'Only the GM can change AI settings.');
        return json({ policy });
      } catch (error) {
        if (error?.code === 'CONFLICT' || error?.status === 409) throw new BoundaryError(409, 'Obus settings changed. Refresh AI status before trying again.');
        throw error;
      }
    }),
    aiAsk: route(async request => {
      sameOrigin(request); const { game, scope } = await authenticate(request), { ai } = await getServices();
      const input = await readBody(request, ['requestId', 'expectedRevision', 'task', 'query']);
      const role = game.member(scope), view = game.view(scope);
      if (input.expectedRevision !== view.revision) throw new BoundaryError(409, 'The scene changed; request fresh assistance.');
      const tasks = role === 'host' ? ['narration', 'dialogue', 'prepare', 'contradiction'] : ['narration'];
      if (!tasks.includes(input.task)) throw new BoundaryError(403, 'Use the dedicated counsel or council controls for that task.');
      const result = await ai.run({ ...scope, role }, { ...input, session: 'campaign', sourceRevision: view.revision, evidence: { view, world: game.world(scope) }, exportable: false });
      game.member(scope);
      return json({ result, historical: game.view(scope).revision !== view.revision });
    }),
    council: route(async request => { const { game, scope } = await authenticate(request); return json({ council: game.council(scope) }); }),
    chooseCouncil: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      const input = await readBody(request, ['requestId', 'round', 'branchId', 'expectedWorldRevision']);
      return json({ receipt: game.chooseCouncil(scope, input), council: game.council(scope), world: game.world(scope) });
    }),
    counsel: route(async request => { const { game, scope } = await authenticate(request); return json({ counsel: game.counsel(scope) }); }),
    askCounsel: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      const input = await readBody(request, ['requestId', 'expectedRevision', 'expectedWorldRevision', 'topic']);
      return json({ record: game.askCounsel(scope, input), counsel: game.counsel(scope) });
    }),
    characterOptions: route(async request => {
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Open character details without extra fields.');
      return json({ options: getCharacterOptions(game, scope) });
    }),
    characterInfo: async (request, actorId) => {
      try {
        const { game, scope } = await authenticate(request);
        const params = new URL(request.url).searchParams;
        if ([...params.keys()].some(k => k !== 'revision') || params.getAll('revision').length > 1 || (params.has('revision') && !/^(0|[1-9][0-9]{0,14})$/.test(params.get('revision')))) throw new BoundaryError(400, 'Choose a current character view.');
        const input = { actorId, ...(params.has('revision') ? { expectedRevision: Number(params.get('revision')) } : {}) };
        return json({ info: getCharacterInfo(game, await getCharacters(), scope, input) });
      } catch (error) { return failure(error); }
    },
    world: route(async request => { const { game, scope } = await authenticate(request); return json({ world: game.world(scope) }); }),
    debrief: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      const input = await readBody(request, ['requestId', 'expectedRevision', 'notes']);
      return json({ receipt: game.debrief(scope, input), world: game.world(scope) });
    }),
    journal: route(async request => {
      const { game, scope } = await authenticate(request);
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(k => k !== 'after') || params.getAll('after').length !== 1 || !/^(0|[1-9][0-9]{0,14})$/.test(params.get('after'))) throw new BoundaryError(400, 'Supply one journal revision cursor.');
      return json(game.journal(scope, Number(params.get('after'))));
    }),
    imageScene: images.scene,
    imageRequest: images.requestImage,
    imageHistory: images.history,
    imageJob: images.job,
    imageContent: images.image,
    updates: route(async request => {
      const { game, scope } = await authenticate(request);
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(k => k !== 'after') || params.getAll('after').length !== 1 || !/^(0|[1-9][0-9]{0,14})$/.test(params.get('after'))) throw new BoundaryError(400, 'Supply one revision cursor.');
      return json(game.updates(scope, Number(params.get('after'))));
    }),
    reachOptions: route(async request => {
      const { game, scope } = await authenticate(request);
      if (new URL(request.url).search) throw new BoundaryError(400, 'Open distance and reach without extra fields.');
      return json({ options: getReachOptions(game, scope) });
    }),
    reach: route(async request => {
      sameOrigin(request);
      const { game, scope } = await authenticate(request);
      const input = await readBody(request, ['expectedRevision', 'actorId', 'targetId', 'coordinate']);
      return json({ result: assessReach(game, scope, input) });
    }),
    connect: route(async request => {
      sameOrigin(request);
      const { token } = await readBody(request, ['token']);
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new BoundaryError(401, 'Enter a valid player access code.');
      await authenticate(request, token);
      return json({ connected: true }, 200, { 'Set-Cookie': cookie(request, token) });
    }),
    disconnect: route(async request => { sameOrigin(request); return json({ connected: false }, 200, { 'Set-Cookie': cookie(request) }); }),
    state: route(async request => {
      const { game, scope } = await authenticate(request);
      return json({ view: game.view(scope), receipts: game.receipts(scope) });
    }),
    command: route(async request => {
      sameOrigin(request);
      const input = await readBody(request, ['requestId', 'expectedRevision', 'actorId', 'type', 'path', 'targetId']);
      const { game, scope } = await authenticate(request);
      const receipt = game.command(scope, input);
      return json({ receipt, view: game.view(scope) });
    }),
    map: route(async request => {
      const { game, scope } = await authenticate(request);
      const requested = new URL(request.url).searchParams;
      if ([...requested.keys()].some(k => k !== 'revision') || requested.getAll('revision').length !== 1 || !/^[0-9]{1,15}$/.test(requested.get('revision'))) throw new BoundaryError(400, 'Request a specific map revision.');
      const view = game.view(scope);
      if (view.revision !== Number(requested.get('revision'))) throw new BoundaryError(409, 'A newer map is ready. Refresh your view.');
      const png = render(view, { cellSize: Math.min(64, Math.floor(3900 / Math.max(view.map.width, view.map.height))) });
      return new Response(new Uint8Array(png), { headers: { ...HEADERS, 'Content-Type': 'image/png', 'X-Raph-Revision': String(view.revision) } });
    }),
  };
}
