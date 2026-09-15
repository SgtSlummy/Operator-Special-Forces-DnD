import assert from 'node:assert/strict';
import test from 'node:test';

const synthetic = {
  campaign: 'simulation-behind-the-veil',
  players: ['sim-player-1', 'sim-player-2'],
  approvedLore: [{ id: 'lore-1', campaign: 'simulation-behind-the-veil', visibility: 'host', text: 'The Saltglass beacon marks the courier road.' }],
  privateLore: { campaign: 'other-campaign', visibility: 'private', text: 'must never appear' }
};

function createSimulation() {
  let revision = 0;
  let hostGeneration = 1;
  let aiAvailable = true;
  let consent = true;
  const receipts = [];
  const events = [];
  const state = { turn: 1, scene: 'courier-rescue', players: new Map(synthetic.players.map((id, index) => [id, { id, interface: index ? 'browser' : 'discord', hp: 10, x: index, y: 0 }])) };
  const record = (kind, details = {}) => { revision += 1; const receipt = { revision, hostGeneration, kind, ...details }; receipts.push(receipt); return receipt; };
  return {
    state, receipts, events,
    switchInterface(player, next) { assert.ok(['discord', 'browser'].includes(next)); state.players.get(player).interface = next; record('interface-switch', { player, next }); },
    retrieve(query, campaign) { const visible = synthetic.approvedLore.filter(x => x.campaign === campaign && x.visibility === 'host'); assert.equal(visible.length, 1); assert.match(visible[0].text, /Saltglass/); assert.doesNotMatch(visible[0].text, /must never appear/); record('scoped-retrieval', { query, source: visible[0].id }); return visible[0].text; },
    action(player, action) { if (action === 'unsupported-teleport') { const rejected = record('action-rejected', { player, action, resourceSpent: false }); assert.equal(rejected.resourceSpent, false); return rejected; } const accepted = record('action-accepted', { player, action, resourceSpent: true }); events.push(accepted); return accepted; },
    transcribe(text) { if (!consent) throw Object.assign(new Error('capture consent withdrawn'), { code: 'CONSENT' }); return record('transcript', { text, persistedRawAudio: false, persistedGeneralMemory: false }); },
    withdrawConsent() { consent = false; record('consent-withdrawn'); },
    requestAi() { if (!aiAvailable) return record('manual-fallback', { reason: 'ai-unavailable', authority: 'human' }); return record('ai-suggestion', { confirmed: false }); },
    setAiAvailable(value) { aiAvailable = value; },
    councilVote() { const votes = ['explorer', 'warden', 'scribe', 'scholar', 'quartermaster'].map(role => ({ role, vote: 'proceed', evidence: 'sim-receipt' })); const result = record('council-vote', { votes, equalWeight: true, confirmed: false }); assert.equal(votes.length, 5); assert.ok(votes.every(v => v.evidence)); return result; },
    checkpoint() { return { hostGeneration, revision, snapshot: JSON.stringify([...state.players].map(([, value]) => value)) }; },
    restart() { hostGeneration += 1; record('host-restart', { generation: hostGeneration }); },
    restore(checkpoint) { assert.equal(checkpoint.revision, revision - 1); record('checkpoint-restored', { fromGeneration: checkpoint.hostGeneration }); }
  };
}

export function runSimulation() {
  const sim = createSimulation();
  sim.retrieve('beacon', synthetic.campaign);
  sim.action('sim-player-1', 'unsupported-teleport');
  sim.action('sim-player-1', 'move-octagonal');
  sim.switchInterface('sim-player-1', 'browser');
  sim.switchInterface('sim-player-2', 'discord');
  sim.transcribe('Synthetic courier report');
  sim.withdrawConsent();
  assert.throws(() => sim.transcribe('must not persist'), { code: 'CONSENT' });
  sim.setAiAvailable(false);
  sim.requestAi();
  sim.councilVote();
  const checkpoint = sim.checkpoint();
  sim.restart();
  sim.restore(checkpoint);
  return { status: 'passed', campaign: synthetic.campaign, receipts: sim.receipts, finalHostGeneration: sim.receipts.at(-1).hostGeneration };
}

test('simulation acceptance covers mixed interfaces, scoped data, mechanics, consent, fallback, council, and recovery', () => {
  const result = runSimulation();
  assert.equal(result.status, 'passed');
  assert.equal(result.finalHostGeneration, 2);
  assert.ok(result.receipts.some(x => x.kind === 'manual-fallback'));
  assert.ok(result.receipts.some(x => x.kind === 'checkpoint-restored'));
});
