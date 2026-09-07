// Disposable browser acceptance fixture. Run after npm run build:game.
// Enter q to stop the child and remove only this verified OS-temp directory.
import { mkdtempSync, realpathSync, rmSync, existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { GameStore } from '../game/store.mjs';
import { CharacterStore } from '../characters/store.mjs';
import { emptyDraft, addEvidence } from '../characters/model.mjs';
import { SceneImageService } from '../images/service.mjs';
import { createImageProvider } from '../images/provider.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(app, 'dist/server/index.js'))) throw new Error('Build the app before previewing.');
const cache = join(app, 'node_modules', '.cache'); mkdirSync(cache, { recursive: true });
const buildParent = realpathSync(cache), buildRoot = mkdtempSync(join(buildParent, 'raphael-preview-build-'));
function removeOwned(directory, parentDirectory, prefix) {
  if (!existsSync(directory)) return;
  const target = realpathSync(directory);
  if (dirname(target) !== parentDirectory || !basename(target).startsWith(prefix) || !/^[A-Za-z0-9-]+$/.test(basename(target))) throw new Error('Unsafe cleanup path.');
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
try {
  const entry = join(app, 'dist/server/index.js'), before = readFileSync(entry);
  cpSync(join(app, 'dist'), join(buildRoot, 'dist'), { recursive: true });
  if (!before.equals(readFileSync(entry)) || !before.equals(readFileSync(join(buildRoot, 'dist/server/index.js')))) throw new Error('The build changed while copying. Retry after the build finishes.');
  if (existsSync(join(app, 'public'))) cpSync(join(app, 'public'), join(buildRoot, 'public'), { recursive: true });
  writeFileSync(join(buildRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
} catch (error) { removeOwned(buildRoot, buildParent, 'raphael-preview-build-'); throw error; }
const parent = realpathSync(tmpdir()), root = mkdtempSync(join(parent, 'raphael-companion-preview-'));
const scope = { campaign: 'companion-preview', owner: '111111111111111111' };
const characters = new CharacterStore(join(root, 'characters/characters.sqlite'));
const draft = emptyDraft();
for (const [key, value] of Object.entries({ name: 'Maren Ash · Preview', classes: 'Ranger 3', level: 3, strength: 12, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 15, charisma: 8, armorClass: 15, maxHp: 28, currentHp: 19, speed: 30, proficiencyBonus: 2, initiative: 3, equipment: 'Rope, lantern and a weathered travelling cloak.\nPreview data only.', features: 'Keeps promises. Preview data only.', spells: 'No spell rules have been configured for this fixture.' })) addEvidence(draft, key, value, { method: 'form', page: 1 });
const job = characters.createJob(scope, 'preview-import');
characters.ready(job.id, scope, draft, 'preview-fixture');
const saved = characters.approve(job.id, scope, characters.job(job.id, scope).revision); characters.close();
const version = `approved-${saved.revision}-${createHash('sha256').update(JSON.stringify(saved.snapshot)).digest('hex').slice(0, 16)}`;
const game = new GameStore(join(root, 'game/game.sqlite'));
const actor = (id, name, owner, x, initiative) => ({ id, name, owner, team: owner ? 'party' : 'opposition', x, y: 2, size: 1, hp: 9, maxHp: 28, ac: 15, speed: 30, vision: 6, initiative, characterVersion: owner ? version : 'npc-preview', weapon: { name: 'Spear', abilityScore: 12, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 } });
game.createCampaign({ campaign: scope.campaign, title: 'Disposable companion preview', members: [{ owner: 'host', role: 'host' }, { owner: scope.owner, role: 'player' }], map: { id: 'courtyard', title: 'Preview courtyard', width: 14, height: 9, blocked: [], difficult: [] }, actors: [actor('maren', 'Maren Ash · Preview', scope.owner, 1, 20), actor('guard', 'Visible guard · Preview', null, 5, 10), actor('hidden', 'UNSEEN_PREVIEW_ACTOR', null, 12, 1)], effects: [] });
game.close();
const artRoot = resolve(app, '../campaign-art/witnesslight');
const images = new SceneImageService({ dataDir: join(root, 'images'), artRoot, provider: createImageProvider({ apiKey: '' }) });
const token = images.issueBrowserAccess(scope); await images.close();
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const child = spawn(process.execPath, [join(app, 'node_modules/vinext/dist/cli.js'), 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: buildRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
  ...process.env, NODE_ENV: 'production', RAPHAEL_LOCAL_HOST: '1', OPENAI_API_KEY: '', RAPHAEL_GAME_DATA_DIR: join(root, 'game'), RAPHAEL_DATA_DIR: join(root, 'characters'), RAPHAEL_IMAGE_DATA_DIR: join(root, 'images'), RAPHAEL_ART_ROOT: artRoot,
} });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
let stopping = false;
function cleanup() {
  removeOwned(root, parent, 'raphael-companion-preview-');
  removeOwned(buildRoot, buildParent, 'raphael-preview-build-');
}
child.once('close', () => { clearTimeout(expiry); cleanup(); console.log('Disposable preview data and build snapshot removed.'); process.exitCode = stopping ? 0 : 1; process.stdin.pause(); });
child.once('error', error => { console.error(error.message); });
function stop() { if (!stopping) { stopping = true; child.kill(); } }
const expiry = setTimeout(stop, 8 * 60 * 1000); expiry.unref();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
process.stdin.on('data', value => { if (value.toString().includes('q')) stop(); });
console.log(JSON.stringify({ preview: `http://127.0.0.1:${port}/play`, fixtureCode: token, fixtureRoot: root, buildRoot, expiresInSeconds: 480, hostPid: process.pid, childPid: child.pid }));
