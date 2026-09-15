// Real Obus inference in a new disposable campaign; this runner NEVER commits engine commands.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { ObusTransport } from '../ai/obus.mjs';
import { createLocalObusHostControl } from '../ai/host-config.mjs';
import { createParty } from './party.mjs';

const source = resolve(process.argv[2]), output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const campaignId = `party-fixture-${randomUUID().slice(0, 12)}`;
const actors = [{ actorId: 'lantern-fighter', ownerId: 'ai-fighter' }, { actorId: 'lantern-rogue', ownerId: 'ai-rogue' }, { actorId: 'lantern-cleric', ownerId: 'ai-cleric' }];
const projections = new Map(await Promise.all(actors.map(async actor => {
  const { projection } = JSON.parse(await readFile(join(source, `02-decisions-open-${actor.actorId}.json`), 'utf8'));
  return [actor.actorId, { ...projection, campaignId }];
})));
const transport = new ObusTransport({ url: process.env.RAPHAEL_OBUS_URL || 'http://127.0.0.1:38176' });
await transport.runtimeState({ campaign: campaignId }, 'campaign');
let control;
try { control = createLocalObusHostControl({ transport }); }
catch {
  // A new disposable runtime lazily creates its host key only during signature
  // verification. This intentionally invalid signature creates the key, but cannot
  // authorize a policy/session mutation. No credential is returned or logged.
  const bootstrap = await transport.fetch(`${transport.url}/api/game/runtime/host-generation/renew`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { ...transport.headers(),
    'X-Obus-Game-Host-Timestamp': String(Math.floor(Date.now() / 1000)), 'X-Obus-Game-Host-Nonce': randomBytes(32).toString('hex'), 'X-Obus-Game-Host-Signature': '0'.repeat(64) }, body: '{}' });
  if (bootstrap.status !== 401) throw new Error('Disposable fixture host bootstrap was not rejected as expected.');
  control = createLocalObusHostControl({ transport });
}
const sessions = new Map(), intents = [], diagnostics = []; let enabled = true, party, timer, renewing;
for (const method of ['capabilities', 'runtime', 'generate']) {
  const original = transport[method].bind(transport);
  transport[method] = async (...args) => {
    const start = Date.now();
    try { const result = await original(...args); diagnostics.push({ stage: method, status: 'ready', durationMs: Date.now() - start,
      ...(method === 'generate' ? { model: result.model, routeId: result.routeId, trace: result.trace, sourceCount: result.sources?.length ?? 0 } : {}) }); return result; }
    catch (error) { diagnostics.push({ stage: method, status: 'failed', durationMs: Date.now() - start, reason: String(error.message ?? 'unavailable').slice(0, 200) }); throw error; }
  };
}
const generation = randomUUID();
const client = { campaignId, async project({ ownerId, actorId, audience }) {
  if (audience !== 'private' || !actors.some(a => a.actorId === actorId && a.ownerId === ownerId)) throw new Error('Fixture scope denied');
  return structuredClone(projections.get(actorId));
}, async command() { const error = new Error('Fixture intentionally prohibits engine writes'); error.code = 'FIXTURE_NO_COMMIT'; throw error; } };
async function renew(session) {
  const state = await control.getRuntime({ campaign: campaignId, session });
  const result = await control.renew({ campaign: campaignId, session, generation, expectedBootEpoch: state.bootEpoch, expectedSessionPolicyRevision: state.sessionPolicyRevision, opId: randomUUID(), leaseSeconds: 30 }); sessions.set(session, result);
}
let result;
try {
  const initial = await control.getRuntime({ campaign: campaignId, session: 'campaign' });
  const registered = await control.register({ campaign: campaignId, session: 'campaign', generation, expectedBootEpoch: initial.bootEpoch, expectedGeneration: null, opId: randomUUID(), leaseSeconds: 30 });
  sessions.set('campaign', await control.configure({ campaign: campaignId, session: 'campaign', expectedBootEpoch: registered.bootEpoch, expectedGeneration: generation, expectedSessionPolicyRevision: registered.sessionPolicyRevision, opId: randomUUID(), policy: { enabled: true, mode: 'local', codex: false, exportable: false } }));
  timer = setInterval(() => { if (renewing) return; renewing = Promise.all([...sessions.keys()].map(renew)).catch(() => { enabled = false; party?.close(); diagnostics.push('fixture_lease_renewal_failed'); }).finally(() => { renewing = null; }); }, 8000);
  party = createParty({ client, campaignId, actors, transport, authorizeAI: async scope => actors.some(a => a.actorId === scope.actorId && a.ownerId === scope.userId), getGate: async () => ({ decisionOpen: enabled, hasPendingRulings: false }),
    provisionSession: async ({ session }) => {
      if (sessions.has(session)) return renew(session);
      const master = await control.getRuntime({ campaign: campaignId, session: 'campaign' });
      sessions.set(session, await control.register({ campaign: campaignId, session, generation, expectedBootEpoch: master.bootEpoch, expectedGeneration: null, opId: randomUUID(), leaseSeconds: 30 }));
    }, onIntent: intent => intents.push(intent) });
  party.start(); result = await party.onDecisionOpened({ opportunityId: 'fixture-one', timeoutMs: 110000, maxTokens: 250 });
} catch (error) { result = { status: 'blocked', reason: error.code ?? 'private_obus_unavailable' }; }
finally {
  clearInterval(timer); party?.close(); if (renewing) await renewing;
  for (const session of [...sessions.keys()].filter(s => s !== 'campaign')) {
    try { const state = await control.getRuntime({ campaign: campaignId, session }); await control.revoke({ campaign: campaignId, session, generation, expectedBootEpoch: state.bootEpoch, expectedSessionPolicyRevision: state.sessionPolicyRevision, opId: randomUUID() }); } catch { diagnostics.push('fixture_child_cleanup_failed'); }
  }
  if (sessions.has('campaign')) try {
    const state = await control.getRuntime({ campaign: campaignId, session: 'campaign' });
    await control.configure({ campaign: campaignId, session: 'campaign', expectedBootEpoch: state.bootEpoch, expectedGeneration: generation, expectedSessionPolicyRevision: state.sessionPolicyRevision, opId: randomUUID(), policy: { enabled: false, mode: 'local', codex: false, exportable: false } });
  } catch { diagnostics.push('fixture_master_cleanup_failed'); }
}
const report = { campaignId, result, intents, diagnostics, scope: 'Real private Obus gameplay-route inference; source views are actual Unity projection fixtures; engine writes prohibited; not live gameplay or blind validation.' };
const path = join(output, `${campaignId}.json`); await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ path, status: result.status, proposedIntents: intents.length, committed: result.committed?.length ?? 0, diagnostics }, null, 2));
