import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckRequestPanel } from '../../app/play/check-request-panel';
import { PendingDamageNotice, SavedDamageDetails, type SavedDamageConsequence } from '../../app/play/check-consequences';
import './style.css';

type Body = { id: string; actorId: string; label: string; expectedRevision: number; consequence: { type: 'single_target_damage'; damageType: string; onSuccess: 'half' | 'none' } };
type SavedCheck = { campaign: string; id: string; hash: string; body: Body; response: { check: { id: string; label: string } }; resolved: boolean };
type Entry = { sequence: number; event: string; campaign: string; id?: string; hash?: string; body?: unknown; status?: number; note?: string };
const listeners = new Set<() => void>();
let version = 0;
let run = 1;
const fixture = {
  campaign: 'fixture-alpha-1', viewRevision: 10, serverRevision: 10,
  role: 'host' as 'host' | 'player', refreshFails: false, canRequest: true,
  nextPost: 'normal' as 'normal' | 'lost' | 'conflict',
  events: [] as Entry[], checks: new Map<string, SavedCheck>(),
  receipt: null as { id: string; revision: number; consequence: SavedDamageConsequence } | null,
  successfulCallbacks: 0,
};
function publish() { version += 1; for (const listener of listeners) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function log(event: string, rest: Omit<Entry, 'sequence' | 'event' | 'campaign'> = {}) {
  fixture.events.push({ sequence: fixture.events.length + 1, event, campaign: fixture.campaign, ...rest });
  publish();
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
async function fingerprint(body: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!url.pathname.endsWith('/api/game/checks/request')) {
    // This fixture never forwards an application API or cross-origin request.
    if (url.pathname.includes('/api/') || url.origin !== location.origin) throw new Error('Fixture blocked a non-fixture request.');
    return originalFetch(input, init);
  }
  init?.signal?.throwIfAborted();
  if (fixture.role !== 'host') { log(`${method} denied`, { status: 403 }); return json({ error: 'Only the host can prepare a reviewed check.' }, 403); }
  if (method === 'GET') {
    log('GET options', { status: 200, note: `server revision ${fixture.serverRevision}` });
    return json({ options: { gameRevision: fixture.serverRevision, phase: 'combat', canRequest: fixture.canRequest, actors: [{ id: 'scout', name: 'Fixture Scout' }] } });
  }
  if (method !== 'POST') return json({ error: 'Fixture method unsupported.' }, 405);
  if (!fixture.canRequest) return json({ error: 'Resolve the pending save first.', code: 'PENDING' }, 409);
  const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '';
  let body: Body;
  try { body = JSON.parse(raw) as Body; } catch { return json({ error: 'Fixture expected JSON.' }, 400); }
  const hash = await fingerprint(raw);
  init?.signal?.throwIfAborted();
  log('POST attempt', { id: body.id, hash, body });
  const key = `${fixture.campaign}:${body.id}`;
  const previous = fixture.checks.get(key);
  if (previous) {
    if (previous.hash !== hash) { log('POST changed replay rejected', { id: body.id, hash, status: 409 }); return json({ error: 'The request ID already belongs to different reviewed mechanics.' }, 409); }
    log('POST identical replay', { id: body.id, hash, status: 200 });
    return json(previous.response);
  }
  if (fixture.nextPost === 'conflict') {
    fixture.nextPost = 'normal'; fixture.serverRevision += 1;
    log('POST confirmed conflict', { id: body.id, hash, status: 409, note: 'No check committed; map revision advanced.' });
    return json({ error: 'The map changed. Refresh and review the save again.', code: 'STALE' }, 409);
  }
  if (body.expectedRevision !== fixture.serverRevision) {
    log('POST stale revision', { id: body.id, hash, status: 409 });
    return json({ error: 'The map changed. Refresh and review the save again.', code: 'STALE' }, 409);
  }
  if (!body.id || body.actorId !== 'scout' || body.consequence?.type !== 'single_target_damage') return json({ error: 'Fixture request is incomplete.' }, 422);
  const response = { check: { id: body.id, label: body.label } };
  fixture.checks.set(key, { campaign: fixture.campaign, id: body.id, hash, body, response, resolved: false });
  // Preparing a reviewed check does not change the game revision or roll dice.
  log('POST committed once', { id: body.id, hash, status: 200 });
  if (fixture.nextPost === 'lost') {
    fixture.nextPost = 'normal';
    log('POST response lost after commit', { id: body.id, hash, note: 'Simulated network failure; retry must use the identical ID and body.' });
    throw new TypeError('Fixture lost the response after committing the reviewed check.');
  }
  return json(response);
};

function reset() {
  run += 1;
  Object.assign(fixture, { campaign: `fixture-alpha-${run}`, viewRevision: 10, serverRevision: 10, role: 'host', refreshFails: false, canRequest: true, nextPost: 'normal', events: [], checks: new Map(), receipt: null, successfulCallbacks: 0 });
  publish();
}
function role(value: 'host' | 'player') {
  fixture.role = value; fixture.serverRevision += 1; fixture.viewRevision = fixture.serverRevision;
  log(`Session role changed to ${value}`);
}
function mismatch() {
  fixture.serverRevision += 2; fixture.viewRevision = fixture.serverRevision - 1;
  log('Parent map is one revision behind options');
}
function switchCampaign() {
  fixture.campaign = fixture.campaign.includes('alpha') ? `fixture-beta-${run}` : `fixture-alpha-${run}`;
  fixture.serverRevision = 10; fixture.viewRevision = 10; fixture.receipt = null; fixture.nextPost = 'normal';
  log('Campaign switched; real component key must clear the old draft');
}
async function refreshGame() {
  if (fixture.refreshFails) { log('Map refresh failed', { note: 'Callback rejected; review must remain blocked.' }); throw new Error('Fixture map refresh failed.'); }
  fixture.viewRevision = fixture.serverRevision;
  log('Map refresh succeeded', { note: `parent revision ${fixture.viewRevision}` });
}
function resolveLatest() {
  const check = [...fixture.checks.values()].reverse().find(item => item.campaign === fixture.campaign && !item.resolved);
  if (!check) { log('No unresolved fixture check to resolve'); return; }
  check.resolved = true; fixture.serverRevision += 2; fixture.viewRevision = fixture.serverRevision;
  // Fixed saved values exercise presentation only. No random generator exists in this fixture.
  fixture.receipt = { id: check.id, revision: fixture.serverRevision, consequence: {
    type: 'single_target_damage', damageType: 'fire', dice: [6, 5], dieSides: 6, bonus: 2,
    rolledTotal: 13, afterSave: 13, mitigation: { reduction: 0, resistance: false, vulnerability: false, immunity: false },
    appliedDamage: 13, hpBefore: 20, hpAfter: 7,
  } as SavedDamageConsequence };
  log('Fixed saved receipt displayed', { id: check.id, note: 'HP 20 → 7; damage 13; zero RNG calls. Presentation fixture, not rules execution.' });
}
function Fixture() {
  useSyncExternalStore(subscribe, () => version);
  const currentChecks = [...fixture.checks.values()].filter(check => check.campaign === fixture.campaign);
  const pending = [...currentChecks].reverse().find(check => !check.resolved);
  return <main>
    <header><p className="eyebrow">Local browser test fixture</p><h1>Reviewed save lifecycle</h1>
      <p>These are the real Raph review and saved-damage components. The local fetch boundary is fake: it uses no accounts, database, live Discord, image generation, or random dice.</p>
      <p>Fill the real form manually. Scenario controls alter only the fixture. A successful request prepares a check; the separate receipt button displays fixed saved results.</p>
    </header>
    <section aria-label="Fixture scenario controls" className="controls">
      <button onClick={reset}>Reset host fixture</button>
      <button onClick={() => role('player')}>Deny host role</button>
      <button onClick={() => role('host')}>Restore host role</button>
      <button onClick={mismatch}>Make options newer than map</button>
      <button onClick={() => { fixture.refreshFails = true; log('Map refresh failure enabled'); }}>Fail map refresh</button>
      <button onClick={() => { fixture.refreshFails = false; log('Map refresh failure disabled'); }}>Allow map refresh</button>
      <button onClick={() => { fixture.nextPost = 'lost'; log('Next POST will commit then lose its response'); }}>Next POST: lose committed response</button>
      <button onClick={() => { fixture.nextPost = 'conflict'; log('Next POST will return a confirmed 409 without committing'); }}>Next POST: confirmed 409</button>
      <button onClick={() => { fixture.canRequest = !fixture.canRequest; fixture.serverRevision += 1; fixture.viewRevision = fixture.serverRevision; log(fixture.canRequest ? 'Pending save lock cleared' : 'Pending concentration lock enabled'); }}>Toggle pending concentration lock</button>
      <button onClick={switchCampaign}>Switch campaign</button>
      <button onClick={resolveLatest} disabled={!pending}>Show fixed saved receipt</button>
    </section>
    <section aria-label="Fixture state" className="state">
      <dl><dt>Campaign</dt><dd>{fixture.campaign}</dd><dt>Role</dt><dd>{fixture.role}</dd><dt>Parent map revision</dt><dd>{fixture.viewRevision}</dd><dt>Server options revision</dt><dd>{fixture.serverRevision}</dd><dt>Map refresh</dt><dd>{fixture.refreshFails ? 'will fail' : 'will succeed'}</dd><dt>Next POST</dt><dd>{fixture.nextPost}</dd><dt>Committed checks in campaign</dt><dd>{currentChecks.length}</dd><dt>POST attempts in campaign</dt><dd>{fixture.events.filter(event => event.campaign === fixture.campaign && event.event === 'POST attempt').length}</dd><dt>Successful request callbacks</dt><dd>{fixture.successfulCallbacks}</dd><dt>RNG calls</dt><dd>0 (fixed fixture values)</dd></dl>
    </section>
    <section aria-label="Real review component" className="component">
      <h2>Actual host review controls</h2>
      <CheckRequestPanel campaign={fixture.campaign} gameRevision={fixture.viewRevision} onRefreshGame={refreshGame}
        onRequested={() => { fixture.successfulCallbacks += 1; log('onRequested callback completed'); }} />
      <p className="hint">When the fake role is denied, the real component should render no host form.</p>
    </section>
    <section aria-label="Saved check and receipt" className="component">
      <h2>Actual pending notice and saved damage details</h2>
      {pending ? <><p>Pending check: <code>{pending.id}</code></p><PendingDamageNotice consequence={pending.body.consequence} /></> : <p>No unresolved fixture check.</p>}
      {fixture.receipt && <><p>Saved receipt <code>{fixture.receipt.id}</code>, revision {fixture.receipt.revision}. These are fixed fixture values.</p><SavedDamageDetails consequence={fixture.receipt.consequence} /></>}
    </section>
    <section aria-label="Fixture request log"><h2>Request and lifecycle evidence</h2><p>Full request bodies contain fake fixture data only. Identical retry IDs and SHA-256 hashes must match, while committed check count stays at one.</p>
      <pre id="fixture-request-log">{JSON.stringify(fixture.events, null, 2)}</pre>
    </section>
  </main>;
}
const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root.');
createRoot(container).render(<Fixture />);
