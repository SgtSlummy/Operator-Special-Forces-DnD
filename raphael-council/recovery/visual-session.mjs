import { mkdir, readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameStore } from '../game/store.mjs';
import { tacticalImageScene } from '../game/image-scene.mjs';
import { SceneImageService } from '../images/service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artRoot = resolve(root, '../campaign-art/witnesslight');
const scope = { campaign: 'visual-session', owner: 'player' };

export async function runVisualSession({ temporaryRoot = null } = {}) {
  const ownedRoot = temporaryRoot ?? await mkdtemp(join(tmpdir(), 'raphael-visual-session-'));
  await mkdir(ownedRoot, { recursive: true });
  const game = new GameStore(join(ownedRoot, 'game.sqlite'), { rollDie: sides => sides === 20 ? 20 : sides });
  let activeSceneOverride = null;
  const sceneImages = new SceneImageService({
    dataDir: join(ownedRoot, 'images'), artRoot,
    provider: async () => readFile(sceneImages.asset('11-saltglass-shore')),
    resolveScene: currentScope => ({
      ...(activeSceneOverride ?? tacticalImageScene(game.view(currentScope), currentScope)),
      approvedImage: activeSceneOverride?.approvedImage ?? '11-saltglass-shore',
    }),
  });
  const steps = [];
  const imageAt = async (label, action = null) => {
    const view = game.view(scope);
    const scene = await sceneImages.scene(scope);
    const job = await sceneImages.waitForJob(scope, (await sceneImages.requestImage(scope, { requestId: `visual-${steps.length + 1}`, focusId: 'scene' })).id, { timeoutMs: 5000 });
    steps.push({
      screen: label, characterQuestion: 'Mr. Mecha Cannibal asks: What do I see?',
      action, gameRevision: view.revision, sceneRevision: scene.revision,
      location: { id: scene.id, title: scene.title, description: scene.description },
      map: { title: view.map.title, width: view.map.width, height: view.map.height, blocked: view.map.blocked, difficult: view.map.difficult },
      actors: view.actors.map(actor => ({ id: actor.id, name: actor.name, coordinate: `${actor.x},${actor.y}`, hp: actor.hp, defeated: actor.defeated })),
      image: { status: job.status, jobId: job.id, sceneRevision: job.sceneRevision, approvedImage: activeSceneOverride?.approvedImage ?? '11-saltglass-shore' },
    });
    return job;
  };
  try {
    game.createCampaign({ campaign: scope.campaign, title: 'Behind the Veil · Saltglass Shore',
      members: [{ owner: 'host', role: 'host' }, { owner: scope.owner, role: 'player' }],
      map: { id: 'saltglass-shore', title: 'Saltglass Shore', width: 8, height: 6, blocked: [{ x: 3, y: 1 }], difficult: [{ x: 2, y: 1 }] },
      actors: [
        { id: 'mecha', name: 'Mr. Mecha Cannibal', owner: scope.owner, team: 'party', x: 1, y: 1, size: 1, hp: 20, maxHp: 20, ac: 16, speed: 30, vision: 8, initiative: 20, characterVersion: 'visual-v1', weapon: { name: 'Cannon', abilityScore: 18, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 30 } },
        { id: 'saltglass-sentinel', name: 'Saltglass Sentinel', owner: null, team: 'opposition', x: 3, y: 2, size: 1, hp: 6, maxHp: 6, ac: 12, speed: 30, vision: 8, initiative: 10, characterVersion: 'visual-v1', weapon: { name: 'Rust blade', abilityScore: 12, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 4, addAbilityToDamage: true, rangeFeet: 5 } },
      ], effects: [] });
    await imageAt('OPENING LOCATION', { type: 'enter_campaign', cost: 'none' });
    const move = game.command(scope, { requestId: 'move-to-shoreline', expectedRevision: game.view(scope).revision, actorId: 'mecha', type: 'move', path: [{ x: 2, y: 1 }, { x: 2, y: 2 }] });
    await imageAt('EXPLORATION · DIFFICULT TERRAIN', { type: 'move', path: move.result.path, cost: `${move.result.cost ?? 'exploration'} movement; difficult terrain at 2,1` });
    const attack = game.command(scope, { requestId: 'fire-cannon', expectedRevision: game.view(scope).revision, actorId: 'mecha', type: 'attack', targetId: 'saltglass-sentinel' });
    await imageAt('COMBAT · FORCE CANNON', { type: 'attack', roll: attack.result });
    activeSceneOverride = { campaign: scope.campaign, audience: scope.owner, id: 'abbey-archive', title: 'Abbey Archive', sourceEventId: `narrative:${scope.campaign}:abbey`, gameRevision: game.view(scope).revision, approvedImage: '12-drowned-abbey',
      description: 'A salt-stained courier waits beneath the Abbey archive vault. The visible ledger table is empty except for one brass seal and a wet trail leading toward the records door.',
      references: [], subjects: [{ id: 'courier', label: 'The salt-stained courier', description: 'A visible injured courier holding a brass seal. No hidden testimony is assumed.' }] };
    sceneImages.publishScene(activeSceneOverride);
    await imageAt('ABBEY ARCHIVE · INVESTIGATION', { type: 'inspect', cost: 'none', result: 'The brass seal bears the same three-wave mark seen on the shore.' });
    activeSceneOverride = { ...activeSceneOverride, sourceEventId: `narrative:${scope.campaign}:abbey-decision`, description: 'The courier offers the brass seal and asks whether Mr. Mecha Cannibal will carry it into the sealed records room. The wet trail disappears beneath the locked door.' };
    sceneImages.publishScene(activeSceneOverride);
    await imageAt('ABBEY ARCHIVE · DECISION', { type: 'decision', choice: 'Carry the seal into the records room', cost: 'none', result: 'Lead accepted; the locked records door becomes the next objective.' });
    return { session: 'Behind the Veil: Saltglass Shore', checkpoint: { campaign: scope.campaign, revision: game.view(scope).revision, scene: activeSceneOverride.id, sceneImageRevision: steps.at(-1).sceneRevision, resumable: true }, steps };
  } finally {
    await sceneImages.close(); game.close();
    if (!temporaryRoot) await rm(ownedRoot, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('visual-session.mjs')) {
  console.log(JSON.stringify(await runVisualSession(), null, 2));
}
