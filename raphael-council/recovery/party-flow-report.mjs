import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCampaignAction, createCampaignFlow, projectThreads } from '../game/campaign-flow.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'tmp', 'party-flow', 'session.json');
const owners = ['player-1', 'player-2', 'player-3'];
let state = createCampaignFlow({ campaign: 'saltglass-shore-thread-playtest', title: 'Saltglass Shore · Thread Playtest' });
const snapshots = [];

function capture(id, label) {
  const projected = projectThreads(state, { owner: 'dm', role: 'host' });
  snapshots.push({
    id,
    label,
    revision: state.revision,
    phase: state.phase,
    general: projected.general,
    store: projected.store,
    players: Object.fromEntries(owners.map(owner => [owner, projectThreads(state, { owner, role: 'player' }).player])),
    admin: projected.admin,
  });
}

capture('combat-open', 'Shared tactical map opens');
state = applyCampaignAction(state, { type: 'spot', owner: 'player-1', role: 'player', ability: 'perception', roll: 10, coord: 'H15' });
capture('branna-discovery', 'Branna privately spots the wind-carved outcropping');
state = applyCampaignAction(state, { type: 'finish_combat', owner: 'dm', role: 'host' });
capture('aftermath', 'Combat ends and the party receives a debrief prompt');
state = applyCampaignAction(state, { type: 'record_debrief', owner: 'dm', role: 'host', notes: 'The courier survives. The party follows the tide road toward the abbey.' });
state = applyCampaignAction(state, { type: 'open_store', owner: 'dm', role: 'host' });
state = applyCampaignAction(state, { type: 'inspect_item', owner: 'player-2', role: 'player', itemId: 'saltglass-lens' });
state = applyCampaignAction(state, { type: 'buy_item', owner: 'player-2', role: 'player', itemId: 'saltglass-lens', quantity: 1 });
capture('store-open', 'Saltglass Outfitters opens with private purchases');
state = applyCampaignAction(state, { type: 'ready_next_scene', owner: 'dm', role: 'host' });
capture('next-scene-ready', 'The party is ready for the next authored scene');

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  campaign: state.campaign,
  title: state.title,
  threadPolicy: {
    general: 'party-visible shared map and public chat',
    store: 'party-visible catalog; wallets and purchases remain private',
    player: 'owner-only projection with discovered terrain and private chat',
    admin: 'host-only full state and all thread projections',
  },
  snapshots,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, snapshots: snapshots.length, finalPhase: state.phase, finalRevision: state.revision }, null, 2));
