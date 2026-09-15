import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createPortablePack, validatePortablePack, projectPlayer } from './portable.mjs';
import { parseExportArguments, exportDocument } from './export.mjs';

const atlas = await readFile(new URL('../DUNGEON_ATLAS.md', import.meta.url), 'utf8');
const pack = createPortablePack(atlas);
const clone = value => structuredClone(value);
const disclosure = (rooms = [], routes = [], currentRoomId = null) => ({
  schemaVersion: 1, packId: pack.packId, sourceRevision: pack.sourceRevision,
  currentRoomId, rooms, routes,
});

test('portable pack survives JSON round trip with all atlas connections', () => {
  assert.deepEqual(validatePortablePack(JSON.parse(JSON.stringify(pack))), pack);
  assert.equal(pack.rooms.length, 18);
  assert.equal(pack.routes.length, 25);
  assert.equal(pack.boundaries.length, 1);
  assert.equal(pack.boundaries[0].requiresGmRuling, true);
  assert.equal(pack.rooms.find(room => room.id === 'R02').scale.widthFeet, 4);
  assert.equal(pack.rooms.find(room => room.id === 'R15').scale.widthFeet, 1600);
  assert.equal(pack.rooms.find(room => room.id === 'R03').scale.verticalKind, 'depth');
  assert.equal(pack.rooms.find(room => room.id === 'R08').scale.verticalKind, 'elevation');
});

test('pack validator rejects incompatible, malformed and disconnected packs', () => {
  for (const mutate of [
    value => { value.schemaVersion = 999; },
    value => { value.rooms[0].scale.widthFeet = 0; },
    value => { value.rooms[0].scale.depthFeet = Infinity; },
    value => { value.rooms[1].id = value.rooms[0].id; },
    value => { value.routes[0].to = 'R99'; },
    value => { value.routes.push(clone(value.routes[0])); },
    value => { value.routes = value.routes.filter(route => route.from !== 'R02' && route.to !== 'R02'); },
    value => { value.surpriseField = 'not in contract'; },
  ]) {
    const value = clone(pack);
    mutate(value);
    assert.throws(() => validatePortablePack(value));
  }
});

test('empty player projection discloses no room, route or GM metadata', () => {
  const view = projectPlayer(pack, disclosure());
  assert.deepEqual(Object.keys(view).sort(), ['schemaVersion', 'kind', 'audience', 'packId', 'sourceRevision', 'currentRoomId', 'rooms', 'routes'].sort());
  assert.deepEqual(view.rooms, []);
  assert.deepEqual(view.routes, []);
  assert.equal(view.currentRoomId, null);
  assert.equal(view.audience, 'player');
});

test('opening disclosure reveals only explicitly selected R01 fields', () => {
  const view = projectPlayer(pack, disclosure([{ roomId: 'R01', name: true, arrival: true }], [], 'R01'));
  assert.deepEqual(view.rooms, [{ id: 'R01', name: pack.rooms[0].name, arrival: pack.rooms[0].arrival }]);
  assert.deepEqual(view.routes, []);
  const serialized = JSON.stringify(view);
  for (const room of pack.rooms.slice(1)) {
    assert.equal(serialized.includes(`"${room.id}"`), false);
    assert.equal(serialized.includes(room.name), false);
  }
  assert.equal('scale' in view.rooms[0], false);
});

test('revealing endpoints does not reveal the connecting route', () => {
  const grants = [{ roomId: 'R01' }, { roomId: 'R04', scale: true }];
  const view = projectPlayer(pack, disclosure(grants));
  assert.deepEqual(view.routes, []);
  assert.deepEqual(view.rooms.find(room => room.id === 'R04').scale, pack.rooms.find(room => room.id === 'R04').scale);
  const linked = projectPlayer(pack, disclosure(grants, [{ routeId: 'R01--R04', passage: true }]));
  assert.equal(linked.routes.length, 1);
  assert.equal(linked.routes[0].passage, pack.routes.find(route => route.id === 'R01--R04').passage);
  assert.equal('gmDetail' in linked.routes[0], false);
});

test('all grants still exclude private notes, purposes and boundary rules', () => {
  const secretPack = clone(pack);
  const canary = 'PRIVATE-CANARY-71384';
  for (const room of secretPack.rooms) {
    room.purpose = canary;
    room.gmNotes = [{ label: canary, text: canary }];
  }
  for (const route of secretPack.routes) route.gmDetail = canary;
  for (const boundary of secretPack.boundaries) boundary.gmDetail = canary;
  const rooms = secretPack.rooms.map(room => ({ roomId: room.id, name: true, arrival: true, scale: true }));
  rooms.push({ roomId: 'surface', name: true });
  const routes = secretPack.routes.map(route => ({ routeId: route.id, passage: true }));
  const view = projectPlayer(secretPack, disclosure(rooms, routes));
  assert.equal(JSON.stringify(view).includes(canary), false);
  assert.equal('boundaries' in view, false);
  assert.equal('gmNotes' in view.rooms[0], false);
  assert.equal('purpose' in view.rooms[0], false);
});

test('invalid grants fail closed', () => {
  const cases = [
    disclosure([{ roomId: 'R01', name: 'true' }]),
    disclosure([{ roomId: 'R01', gmNotes: true }]),
    disclosure([{ roomId: 'R01' }, { roomId: 'R01' }]),
    disclosure([{ roomId: 'R99' }]),
    disclosure([{ roomId: 'R01' }], [{ routeId: 'R01--R04' }]),
    disclosure([{ roomId: 'R17' }], [{ routeId: pack.boundaries[0].id }]),
    disclosure([{ roomId: 'R01' }], [], 'R04'),
    disclosure([{ roomId: 'surface', scale: true }]),
    { ...disclosure(), sourceRevision: '0'.repeat(64) },
    { ...disclosure(), revealAll: true },
    disclosure([{ roomId: 'R01' }, { roomId: 'R04' }], [{ routeId: 'R01--R04' }, { routeId: 'R01--R04' }]),
  ];
  for (const value of cases) assert.throws(() => projectPlayer(pack, value));
});

test('per-recipient grants and output mutations do not alter shared data', () => {
  const original = clone(pack);
  const first = projectPlayer(pack, disclosure([{ roomId: 'R01', name: true, scale: true }]));
  const second = projectPlayer(pack, disclosure([{ roomId: 'R02', name: true }]));
  first.rooms[0].scale.widthFeet = 999;
  first.rooms[0].name = 'changed';
  assert.deepEqual(pack, original);
  assert.equal(second.rooms.length, 1);
  assert.equal(second.rooms[0].id, 'R02');
  const validated = validatePortablePack(pack);
  validated.rooms[0].name = 'also changed';
  assert.deepEqual(pack, original);
});

test('export requires explicit audience, correct suffix and local destination', () => {
  const local = join(tmpdir(), 'undertow.player.json');
  const grants = join(tmpdir(), 'grants.json');
  assert.equal(parseExportArguments(['--audience', 'player', '--out', local, '--disclosure', grants]).audience, 'player');
  for (const args of [
    ['--out', local],
    ['--audience', 'gm', '--out', local],
    ['--audience', 'player', '--out', local],
    ['--audience', 'player', '--out', local, '--disclosure', grants, '--audience', 'gm'],
    ['--audience', 'gm', '--out', join(tmpdir(), 'OneDrive', 'undertow.gm.json')],
    ['--audience', 'gm', '--out', 'relative.gm.json'],
  ]) assert.throws(() => parseExportArguments(args));
});

test('exported files validate, isolate player content and preserve existing files', async () => {
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, 'undertow-export-test-'));
  try {
    const gm = join(directory, 'undertow.gm.json');
    const player = join(directory, 'opening.player.json');
    const grants = join(directory, 'grants.json');
    await writeFile(grants, JSON.stringify(disclosure([{ roomId: 'R01', name: true, arrival: true }], [], 'R01')));
    const gmResult = await exportDocument({ audience: 'gm', output: gm });
    assert.equal(gmResult.verified, true);
    validatePortablePack(JSON.parse(await readFile(gm, 'utf8')));
    const options = { audience: 'player', output: player, disclosure: grants };
    const playerResult = await exportDocument(options);
    assert.deepEqual(Object.keys(playerResult).sort(), ['audience', 'bytes', 'verified']);
    const first = await readFile(player, 'utf8');
    assert.equal(JSON.parse(first).rooms.length, 1);
    assert.equal(first.includes('gmNotes'), false);
    await assert.rejects(() => exportDocument(options));
    assert.equal(await readFile(player, 'utf8'), first);
    await writeFile(grants, '{invalid JSON');
    await assert.rejects(() => exportDocument({ ...options, output: join(directory, 'bad.player.json') }));
  } finally {
    const target = resolve(directory);
    assert.ok(target.startsWith(base + sep) && target !== base);
    await rm(target, { recursive: true, force: true });
  }
});
