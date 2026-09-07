import { createHash } from 'node:crypto';
import { createGameHttp } from '../game/http.mjs';
import { getGameServices } from '../game/runtime.mjs';
import { AuthError, guardOrigin } from '../auth/discord.mjs';
import { ChronicleError, bounded, interval } from './store.mjs';
import { ChronicleCommands } from './commands.mjs';
import { chronicleConfig, getChronicleStore } from './storage.mjs';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const json = (body, status = 200) => Response.json(body, { status, headers });
const error = (status, message) => Object.assign(new ChronicleError(message), { status });
const hostTypes = new Set(['start', 'pause', 'resume', 'voice', 'leave', 'summary', 'end', 'retry-delivery']);
const fields = {
  consent: ['capture', 'external'], note: ['text'], correct: ['entry', 'text'],
  start: ['title', 'mode', 'minutes'], pause: [], resume: [], voice: [], leave: [], summary: [], end: [], 'retry-delivery': [],
};
async function inputOf(request) {
  const reader = request.body?.getReader(); if (!reader) throw error(400, 'Supply a session action.');
  const chunks = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 8192) throw error(413, 'Session action is too large.'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error(400, 'Invalid session action.'); }
  if (!input || Array.isArray(input) || typeof input !== 'object' || !Object.hasOwn(fields, input.type)) throw error(400, 'Unknown session action.');
  const allowed = ['requestId', 'sessionId', 'expectedRevision', 'type', ...fields[input.type]];
  if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9:_-]{1,96}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !(input.sessionId === null || typeof input.sessionId === 'string' && input.sessionId.length <= 100)) throw error(400, 'Invalid session action fields.');
  if (input.type === 'consent' && (typeof input.capture !== 'boolean' || typeof input.external !== 'boolean')) throw error(400, 'Choose both consent settings.');
  if (['note', 'correct'].includes(input.type)) bounded(input.text, 4000);
  if (input.type === 'correct' && (!Number.isSafeInteger(input.entry) || input.entry < 1)) throw error(400, 'Choose a transcript entry.');
  if (input.type === 'start') { bounded(input.title, 100); if (!['human', 'arcade'].includes(input.mode)) throw error(400, 'Choose a session mode.'); interval(input.minutes); }
  return input;
}
function fingerprint(input) { return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))).digest('hex'); }

export function chronicleSnapshot(store, queue, scope, after = 0) {
  const session = store.current(scope.campaign) || store.latest(scope.campaign);
  if (!session) return { owner: scope.owner, role: scope.role, session: null, consent: { capture: false, external: false }, entries: [], next: 0, delivery: { pending: 0, failed: 0, retrying: 0, uncertain: 0, nextAttemptAt: null }, commands: queue.list(scope) };
  const all = store.sharedEntries(session.id), corrections = new Map();
  for (const entry of all) if (entry.kind === 'correction') corrections.set(entry.target, entry);
  const visible = all.filter(entry => !['image-request', 'image-job', 'chapter', 'recap-draft', 'command-receipt'].includes(entry.kind));
  const page = (after === 0 ? visible.slice(-100) : visible.filter(entry => entry.seq > after).slice(0, 100));
  const entries = page.map(entry => {
    const latest = corrections.get(entry.kind === 'correction' ? entry.target : entry.seq);
    const correction = entry.kind === 'correction' ? latest?.deleted ? latest : null : latest;
    return { seq: entry.seq, kind: entry.kind, text: correction?.text ?? entry.text ?? '', user: entry.user, speaker: entry.speaker, at: entry.at, target: entry.target,
      corrected: Boolean(correction), deleted: Boolean(correction?.deleted || entry.deleted),
      canCorrect: ['active', 'paused'].includes(session.status) && ['transcript', 'note', 'scene'].includes(entry.kind) && (scope.role === 'host' || entry.kind === 'transcript' && entry.user === scope.owner) && !correction?.deleted };
  });
  const privacy = store.privacy(session.id, scope.owner);
  return { owner: scope.owner, role: scope.role, session: { id: session.id, title: session.title, status: session.status, revision: store.revision(session.id) }, entries,
    consent: { capture: privacy.capture, external: privacy.external }, next: page.at(-1)?.seq ?? after, delivery: store.deliveryState(session.id), commands: queue.list(scope) };
}

export function createChronicleHttp({ getServices = getGameServices, getStore = getChronicleStore, enabled = campaign => chronicleConfig(campaign).enabled } = {}) {
  const gameHttp = createGameHttp(getServices);
  const boundary = action => async request => {
    try {
      const { game, scope: identity } = await gameHttp.authenticate(request);
      const scope = { ...identity, role: game.member(identity) }, store = getStore(scope.campaign), queue = new ChronicleCommands(store);
      return await action(request, { scope, store, queue });
    } catch (reason) {
      const status = reason instanceof AuthError ? reason.status : reason.status || (reason.code === 'UNAUTHORIZED' ? 403 : reason instanceof ChronicleError ? 400 : 503);
      return json({ error: reason instanceof AuthError || reason instanceof ChronicleError || reason.status ? reason.message : 'The session service is unavailable.' }, status);
    }
  };
  return {
    get: boundary(async (request, { scope, store, queue }) => {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => key !== 'after') || params.getAll('after').length > 1 || params.has('after') && !/^(0|[1-9][0-9]{0,14})$/.test(params.get('after'))) throw error(400, 'Choose one transcript cursor.');
      return json(chronicleSnapshot(store, queue, scope, Number(params.get('after') || 0)));
    }),
    post: boundary(async (request, { scope, store, queue }) => {
      const { auth } = await getServices();
      if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') guardOrigin(request, auth?.config);
      const input = await inputOf(request), digest = fingerprint(input);
      if (hostTypes.has(input.type) && scope.role !== 'host') throw error(403, 'Only the GM can use this session control.');
      return store.transaction(() => {
        const previous = queue.replay(scope, input); if (previous) return json({ command: previous });
        const receipt = store.db.prepare('SELECT fingerprint,result FROM chronicle_mutations WHERE campaign=? AND user=? AND request=?').get(scope.campaign, scope.owner, input.requestId);
        if (receipt) { if (receipt.fingerprint !== digest) throw error(409, 'That request ID belongs to another action.'); return json(JSON.parse(receipt.result)); }
        const current = store.current(scope.campaign) || (input.type === 'retry-delivery' ? store.latest(scope.campaign) : null);
        const session = input.sessionId ? store.get(input.sessionId) : null;
        if ((session && session.campaign !== scope.campaign) || (input.type !== 'start' && (!session || current?.id !== session.id))) throw error(409, 'The active session changed. Refresh the chronicle.');
        if (input.type === 'start' && (input.sessionId !== null || current)) throw error(409, 'End the current session before starting another.');
        const revision = session ? store.revision(session.id) : 0;
        const privacy = session ? store.privacy(session.id, scope.owner) : null;
        const withdrawal = input.type === 'consent' && !(!privacy.capture && input.capture || !privacy.external && input.external);
        if (input.expectedRevision !== revision && !withdrawal) throw error(409, 'The session changed. Refresh before applying that action.');
        if (hostTypes.has(input.type)) {
          if (!enabled(scope.campaign)) throw error(409, 'The host must enable the session scribe before using bot controls.');
          return json({ command: queue.enqueue(scope, input) });
        }
        if (!['active', 'paused'].includes(session.status)) throw error(409, 'This session is closing or ended.');
        let result;
        if (input.type === 'consent') {
          store.consent(session.id, scope.owner, input.capture); store.externalConsent(session.id, scope.owner, input.external);
          store.append(session.id, `web-consent:${scope.owner}:${input.requestId}`, 'session', { user: scope.owner, text: `Capture ${input.capture ? 'enabled' : 'disabled'}; external AI processing ${input.external ? 'permitted' : 'disabled'}.` });
          result = { saved: true };
        } else if (input.type === 'note') {
          if (session.status !== 'active') throw error(409, 'Resume the session before adding a note.');
          const entry = store.append(session.id, `web-note:${scope.owner}:${input.requestId}`, 'note', { user: scope.owner, speaker: scope.owner, text: input.text, exportableAtCapture: privacy.external, externalEpoch: privacy.externalEpoch });
          result = { saved: true, entry: entry.seq };
        } else {
          // correct() owns its own transaction; use its validated primitive below.
          const entries = store.entries(session.id), entry = entries.find(value => value.seq === input.entry);
          const deleted = entries.filter(value => value.kind === 'correction' && value.target === input.entry).at(-1)?.deleted;
          if (!entry || deleted || !['transcript', 'note', 'scene'].includes(entry.kind) || scope.role !== 'host' && (entry.kind !== 'transcript' || entry.user !== scope.owner)) throw error(403, 'You can correct your own transcript; the GM can correct public story entries.');
          const correction = store.append(session.id, `correction:web:${scope.owner}:${input.requestId}`, 'correction', { target: input.entry, user: scope.owner, text: input.text });
          session.watermark = 0; session.nextDue = store.now(); store.save(session);
          result = { saved: true, entry: correction.seq };
        }
        store.db.prepare('INSERT INTO chronicle_mutations VALUES(?,?,?,?,?)').run(scope.campaign, scope.owner, input.requestId, digest, JSON.stringify(result));
        return json(result);
      });
    }),
  };
}
