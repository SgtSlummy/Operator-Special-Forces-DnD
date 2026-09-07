import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { GameStore } from './store.mjs';
import { CharacterStore } from '../characters/store.mjs';
import { characterConfig } from '../characters/runtime.mjs';
import { addEvidence, emptyDraft, FIELDS } from '../characters/model.mjs';
import { getCharacterInfo, getCharacterOptions } from './character-info.mjs';

const scope = { campaign: 'companion', owner: '111111111111111111' };
const other = { ...scope, owner: '222222222222222222' };
const host = { ...scope, owner: '333333333333333333' };
const version = saved => `approved-${saved.revision}-${createHash('sha256').update(JSON.stringify(saved.snapshot)).digest('hex').slice(0, 16)}`;
function draft() {
  const value = emptyDraft();
  for (const [key, content] of Object.entries({ name: 'Maren Ash', classes: 'Ranger 3', level: 3, strength: 12, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 15, charisma: 8, armorClass: 15, maxHp: 28, currentHp: 19, speed: 30, proficiencyBonus: 2, equipment: 'Rope, lantern', features: 'Keeps promises', spells: 'A reviewed spell list' })) addEvidence(value, key, content, { method: 'form', page: 1 });
  value.fields.name.evidence.push({ raw: 'PRIVATE_RAW', method: 'PRIVATE_SOURCE_PATH', page: 1 });
  value.unknown = [{ text: 'PRIVATE_UNSTRUCTURED', page: 1 }];
  value.fields.gmSecret = { value: 'PRIVATE_UNKNOWN_FIELD' };
  return value;
}
function approve(characters, who = scope, request = 'first', data = draft()) {
  const job = characters.createJob(who, request);
  characters.ready(job.id, who, data, 'fixture');
  return characters.approve(job.id, who, characters.job(job.id, who).revision);
}
function token(id, owner, x, y, characterVersion = 'npc-profile-v1') {
  return { id, name: id === 'hero' ? 'Maren Ash' : id, owner, team: owner ? 'party' : 'opposition', x, y, size: 1, hp: 9, maxHp: 28, ac: 15, speed: 30, vision: 10, initiative: id === 'hero' ? 20 : 10, characterVersion, weapon: { name: 'Longbow', abilityScore: 16, proficiencyBonus: 2, proficient: true, equipmentBonus: 1, damageDice: 1, damageDie: 8, addAbilityToDamage: true, rangeFeet: 60 } };
}
function setup(t, mutate = () => {}) {
  let rolls = 0;
  const game = new GameStore(':memory:', { rollDie: () => { rolls++; return 1; } });
  const characters = new CharacterStore(':memory:');
  t.after(() => { game.close(); characters.close(); });
  const saved = approve(characters);
  const seed = { campaign: scope.campaign, title: 'Companion test', members: [{ owner: host.owner, role: 'host' }, { owner: scope.owner, role: 'player' }, { owner: other.owner, role: 'player' }], map: { id: 'courtyard', title: 'Courtyard', width: 12, height: 12, blocked: [], difficult: [] }, actors: [token('hero', scope.owner, 1, 1, version(saved)), token('ally', other.owner, 4, 1), token('enemy', null, 6, 1)], effects: [] };
  mutate(seed); game.createCampaign(seed);
  const info = (input = {}, who = scope) => getCharacterInfo(game, characters, who, { actorId: 'hero', ...input });
  return { game, characters, saved, info, rolls: () => rolls };
}
function values(info) { return Object.fromEntries(info.groups.flatMap(group => group.fields).map(field => [field.key, field.value])); }
function snapshot(store) {
  return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    return { name, rows: store.db.prepare(`SELECT * FROM ${name}`).all() };
  });
}

test('matched approved fields and live encounter details share a complete display projection', t => {
  const { info, saved } = setup(t);
  const result = info(); const fields = values(result);
  assert.equal(result.sheet.status, 'matched'); assert.equal(result.sheet.revision, saved.revision);
  assert.deepEqual(result.actor.position, { x: 1, y: 1, coordinate: 'B2', size: 1 });
  assert.equal(result.actor.hp, 9); assert.equal(fields['live.hp'], 9);
  assert.equal(fields['sheet.currentHp'], 19); assert.equal(fields['sheet.dexterity'], 16);
  assert.equal(fields['sheet.equipment'], 'Rope, lantern'); assert.equal(fields['sheet.spells'], 'A reviewed spell list');
  assert.equal(fields['sheet.wisdomModifier'], null); // Missing values are not inferred.
  assert.equal(fields['weapon.damageDice'], 1); assert.equal(fields['weapon.damageDie'], 8);
  assert.equal(fields['weapon.proficient'], true); assert.equal(fields['weapon.equipmentBonus'], 1);
  assert.equal(result.sheet.groups.flatMap(group => group.fields).length, Object.keys(FIELDS).length);
  assert.deepEqual(result.groups.slice(-result.sheet.groups.length), result.sheet.groups);
  assert.match(result.notes.join(' '), /source snapshots, not current encounter resources/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});

test('visible other players and enemies expose only public token fields without reading any sheet', t => {
  const { game } = setup(t);
  const noSheets = { character() { throw new Error('Must not read another character sheet'); } };
  for (const who of [scope, host]) for (const actorId of ['ally']) {
    const result = getCharacterInfo(game, noSheets, who, { actorId });
    assert.deepEqual(Object.keys(result.actor).sort(), ['controlled', 'defeated', 'id', 'name', 'position']);
    assert.equal(result.sheet.status, 'private'); assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].fields.map(field => field.key), ['token.name', 'token.coordinate', 'token.size', 'token.defeated']);
    assert.ok(!JSON.stringify(result).includes('Longbow'));
  }
  const enemy = getCharacterInfo(game, noSheets, scope, { actorId: 'enemy' });
  assert.equal(enemy.sheet.status, 'private'); assert.equal(enemy.actor.hp, undefined);
});

test('host-controlled NPC live statistics do not inherit an unrelated host sheet', t => {
  const { game, characters } = setup(t); approve(characters, host, 'host-sheet');
  const result = getCharacterInfo(game, characters, host, { actorId: 'enemy' });
  assert.equal(result.actor.controlled, true); assert.equal(result.actor.hp, 9);
  assert.equal(result.sheet.status, 'updated'); assert.deepEqual(result.sheet.groups, []);
  assert.ok(!result.groups.flatMap(group => group.fields).some(field => field.key.startsWith('sheet.')));
});

test('a newer approved import does not replace the active encounter profile', t => {
  const { game, characters, info } = setup(t);
  const updated = draft(); updated.fields.currentHp.value = 28; updated.fields.equipment.value = 'UPDATED_SECRET_EQUIPMENT';
  approve(characters, scope, 'updated', updated);
  const result = info();
  assert.equal(result.sheet.status, 'updated'); assert.equal(result.sheet.revision, 2);
  assert.equal(result.actor.hp, 9); assert.equal(game.view(scope).actors[0].hp, 9);
  assert.deepEqual(result.sheet.groups, []); assert.ok(!JSON.stringify(result).includes('UPDATED_SECRET'));
});

test('a matching revision with a different snapshot digest also omits source fields', t => {
  const { game, characters } = setup(t);
  const saved = characters.character(scope); saved.snapshot.fields.equipment.value = 'SAME_REVISION_SECRET';
  const result = getCharacterInfo(game, { character: () => saved }, scope, { actorId: 'hero' });
  assert.equal(result.sheet.status, 'updated'); assert.ok(!JSON.stringify(result).includes('SAME_REVISION_SECRET'));
});

test('missing approved data and local non-Discord owners still receive live details', t => {
  const { game, info } = setup(t);
  assert.equal(getCharacterInfo(game, null, scope, { actorId: 'hero' }).sheet.status, 'unavailable');
  assert.equal(getCharacterInfo(game, { character: () => null }, scope, { actorId: 'hero' }).actor.hp, 9);
  assert.equal(info().sheet.status, 'matched');
  const local = new GameStore(':memory:'); t.after(() => local.close());
  local.createCampaign({ campaign: 'local', title: 'Local game', members: [{ owner: 'local-host', role: 'host' }], map: { id: 'map', title: 'Map', width: 4, height: 4, blocked: [], difficult: [] }, actors: [token('hero', 'local-host', 1, 1)], effects: [] });
  const result = getCharacterInfo(local, { character() { throw new Error('Numeric importer scope must not be queried'); } }, { campaign: 'local', owner: 'local-host' }, { actorId: 'hero' });
  assert.equal(result.sheet.status, 'unavailable'); assert.equal(result.actor.hp, 9);
});

test('unhandled database failures and corrupt records propagate instead of becoming empty success', t => {
  const { game } = setup(t);
  const failure = new Error('database unavailable');
  assert.throws(() => getCharacterInfo(game, { character() { throw failure; } }, scope, { actorId: 'hero' }), error => error === failure);
  assert.throws(() => getCharacterInfo(game, { character: () => undefined }, scope, { actorId: 'hero' }), /Invalid approved character record/);
  assert.throws(() => getCharacterInfo(game, { character: () => ({ revision: 1, snapshot: { edition: '2024', fields: [] } }) }, scope, { actorId: 'hero' }), /Invalid approved character record/);
});

test('stale revisions, unknown actors, malformed scopes, and arbitrary owner fields fail closed', t => {
  const { game, characters, info } = setup(t);
  assert.throws(() => info({ expectedRevision: 0 }), { code: 'STALE' });
  assert.throws(() => info({ actorId: 'unknown' }), { code: 'NOT_VISIBLE' });
  assert.throws(() => info({ owner: other.owner }), { code: 'INVALID' });
  assert.throws(() => info({ expectedRevision: undefined }), { code: 'INVALID' });
  assert.throws(() => info({ expectedRevision: 1.5 }), { code: 'INVALID' });
  assert.throws(() => getCharacterInfo(game, characters, { ...scope, campaign: 'unrelated' }, { actorId: 'hero' }), { code: 'UNAUTHORIZED' });
  assert.throws(() => getCharacterInfo(game, characters, null, { actorId: 'hero' }), { code: 'UNAUTHORIZED' });
  assert.throws(() => getCharacterOptions(game, { campaign: '../bad', owner: scope.owner }), { code: 'UNAUTHORIZED' });
});

test('options and character details never reveal actors outside the current visible view', t => {
  const { game, info } = setup(t, data => { data.actors[0].vision = 1; });
  assert.deepEqual(getCharacterOptions(game, scope), { revision: 1, mapTitle: 'Courtyard', actors: [{ id: 'hero', label: 'Maren Ash', controlled: true, defeated: false }] });
  assert.throws(() => info({ actorId: 'enemy' }), { code: 'NOT_VISIBLE' });
});

test('current turn, spent action, movement and pause values remain factual and independent', t => {
  const { game, info } = setup(t);
  const command = input => game.command(scope, { expectedRevision: game.view(scope).revision, requestId: `cmd-${game.view(scope).revision}`, actorId: 'hero', ...input });
  command({ type: 'move', path: [{ x: 2, y: 1 }] }); command({ type: 'attack', targetId: 'enemy' });
  let result = info();
  assert.equal(result.actor.position.coordinate, 'C2'); assert.equal(result.actor.turn.movementRemaining, 25); assert.equal(result.actor.turn.actionAvailable, false);
  assert.equal(values(result)['turn.actionAvailable'], false);
  command({ type: 'end_turn' }); result = info();
  assert.deepEqual(result.actor.turn, { active: false, movementRemaining: null, actionAvailable: null });
  command({ type: 'pause' }); result = info();
  assert.equal(result.phase, 'paused'); assert.match(result.notes.join(' '), /Play is paused/);
});

test('repeated reads change no game or character state, events, receipts, outbox or dice', t => {
  const { game, characters, info, rolls } = setup(t);
  const before = { game: snapshot(game), characters: snapshot(characters) };
  for (let n = 0; n < 3; n++) { getCharacterOptions(game, scope); info(); info({ actorId: 'ally' }); }
  assert.deepEqual({ game: snapshot(game), characters: snapshot(characters) }, before);
  assert.equal(rolls(), 0);
});

test('character runtime resolves the same importer directory as the existing bot', () => {
  assert.equal(characterConfig({ LOCALAPPDATA: 'C:/Local' }).dataDir, resolve(join('C:/Local', 'Raphael', 'character-importer')));
  assert.equal(characterConfig({ LOCALAPPDATA: 'C:/Local', RAPHAEL_DATA_DIR: 'C:/Dedicated/importer' }).dataDir, resolve('C:/Dedicated/importer'));
  assert.equal(characterConfig({ XDG_DATA_HOME: '/var/test-data' }).dataDir, resolve(join('/var/test-data', 'Raphael', 'character-importer')));
});
