import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { parseAtlas, newSession, exits, travel, inspectRoom, restoreSession } from './model.mjs';
import { compileFragment } from './build.mjs';
const atlas = await readFile(new URL('../DUNGEON_ATLAS.md', import.meta.url), 'utf8');
const pack = parseAtlas(atlas, 'test-revision');
const room = id => pack.rooms.find(item => item.id === id);
const walk = route => route.reduce((state, destination) => travel(pack, state, destination), newSession(pack));

test('all 18 authored rooms preserve wide scales and vertical qualifiers', () => {
  assert.equal(pack.rooms.length, 18);
  assert.deepEqual([room('R02').width, room('R02').depth], [4, 6]);
  assert.deepEqual([room('R15').width, room('R15').depth], [1600, 900]);
  assert.equal(room('R03').vertical, '160 ft deep');
  assert.equal(room('R08').vertical, '70 ft above channel');
  assert.equal(room('R18').vertical, '300 ft high');
  assert.equal(room('R16').width, 24);
  assert.ok(Math.abs(room('R16').depth - 27.71281292110204) < 0.000001);
  assert.ok(pack.rooms.every(item => item.reveal && item.notes.length));
});
test('ordinary passages are bidirectional, with two distinct service openings', () => {
  assert.equal(pack.routes.length, 25);
  for (const edge of pack.routes) {
    assert.ok(exits(pack, edge.from).some(item => item.destination === edge.to));
    assert.ok(exits(pack, edge.to).some(item => item.destination === edge.from));
  }
  assert.ok(exits(pack, 'R01').some(item => item.destination === 'R02'));
  assert.ok(exits(pack, 'R02').some(item => item.destination === 'R03'));
  assert.ok(!exits(pack, 'R01').some(item => item.destination === 'R03'));
});
test('Stillwater is a special boundary, never an ordinary travel action', () => {
  assert.deepEqual(pack.boundaries.map(item => [item.from, item.name]), [['R17', 'Stillwater']]);
  assert.ok(!exits(pack, 'R17').some(item => item.destination === 'Stillwater'));
  assert.throws(() => travel(pack, walk(['R04', 'R07', 'R12', 'R13', 'R17']), 'Stillwater'), /Choose a passage/);
});
test('short investigation returns without squeezing or destructive actions', () => {
  const state = walk(['R04', 'R08', 'R14', 'R08', 'R04', 'R01', 'surface']);
  assert.equal(state.roomId, 'surface');
  assert.ok(!state.visited.includes('R02'));
  assert.equal(state.moves, 7);
});
test('exploration and final-operation loops remain traversable', () => {
  const state = walk(['R04', 'R05', 'R06', 'R10', 'R11', 'R13', 'R12', 'R14', 'R18', 'R15', 'R16', 'surface']);
  assert.equal(state.roomId, 'surface');
  assert.equal(state.moves, 12);
});
test('all rooms can be visited through actual edges from the start', () => {
  const visited = new Set();
  function visit(state) {
    visited.add(state.roomId);
    for (const exit of exits(pack, state.roomId)) if (!visited.has(exit.destination)) visit(travel(pack, state, exit.destination));
  }
  visit(newSession(pack));
  assert.equal(visited.size, 19);
});
test('travel cannot teleport and never mutates its input', () => {
  const before = newSession(pack), copy = structuredClone(before);
  assert.throws(() => travel(pack, before, 'R18'), /Choose a passage/);
  assert.throws(() => travel(pack, before, '__proto__'), /Choose a passage/);
  const after = travel(pack, before, 'R04');
  assert.deepEqual(before, copy);
  assert.equal(after.roomId, 'R04');
  assert.notEqual(after.visited, before.visited);
});
test('investigation is idempotent and does not invent outcomes or movement', () => {
  const before = newSession(pack), after = inspectRoom(pack, before);
  assert.deepEqual(before.inspected, []);
  assert.deepEqual(after.inspected, ['R01']);
  assert.deepEqual(inspectRoom(pack, after), after);
  assert.equal(after.moves, 0);
  const outside = travel(pack, before, 'surface');
  assert.deepEqual(inspectRoom(pack, outside), outside);
});
test('save roundtrip retains progress and strips extra input properties', () => {
  const state = inspectRoom(pack, walk(['R04', 'R07', 'R12']));
  const restored = restoreSession(pack, { ...JSON.parse(JSON.stringify(state)), html: '<script>bad</script>' });
  assert.deepEqual(restored, state);
  restored.visited.push('R18');
  assert.ok(!state.visited.includes('R18'));
});
test('incompatible, malformed and impossible saves are rejected', () => {
  const state = walk(['R04']);
  const invalid = [null, [], {}, { ...state, version: 99 }, { ...state, packRevision: 'old' },
    { ...state, roomId: 'Stillwater' }, { ...state, visited: ['R01'] },
    { ...state, inspected: ['R18'] }, { ...state, moves: Infinity }, { ...state, moves: -1 },
    { ...state, journal: [] }, { ...state, journal: [{ from: 'R01', to: 'R18' }] },
    { ...state, visited: ['R01', 'R04', 'R04'] }, { ...state, moves: 100001 }];
  for (const candidate of invalid) assert.throws(() => restoreSession(pack, candidate));
  assert.equal(state.roomId, 'R04');
});
test('journal stays bounded and restores after long journeys', () => {
  let state = newSession(pack);
  for (let i = 0; i < 45; i++) state = travel(pack, state, i % 2 === 0 ? 'R04' : 'R01');
  assert.equal(state.journal.length, 20);
  assert.equal(state.moves, 45);
  assert.deepEqual(restoreSession(pack, state), state);
});
test('broken atlas data fails the build rather than silently losing content', () => {
  for (const broken of [atlas.replace('| R18 |', '| R19 |'), atlas.replace('1,600 × 900 ft maximum', 'unknown'),
    atlas.replace('R14–R18', 'R14–R99'), atlas.replace('**Reveal:**', '**Missing:**'), atlas.replace('| R14–R18 |', '| R14–R14 |')])
    assert.throws(() => parseAtlas(broken, 'rev'));
});
test('compiled fragment is self-contained, bounded and syntax-valid', async () => {
  const [base, modelSource, interfaceSource] = await Promise.all([
    readFile(new URL('../room-scale.html', import.meta.url), 'utf8'),
    readFile(new URL('./model.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./interface.mjs', import.meta.url), 'utf8')
  ]);
  const { fragment, pack: built } = compileFragment({ atlas, base, modelSource, interfaceSource });
  assert.equal(built.rooms.length, 18);
  assert.ok(Buffer.byteLength(fragment) < 1_000_000);
  assert.ok(!/<html\b|<head\b|<body\b|<!doctype/i.test(fragment));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(fragment));
  const scripts = [...fragment.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const [, source] of scripts) new Script(source);
  const injected = compileFragment({ atlas: atlas.replace('wipe their boots', '</script><img src=x onerror=bad>'), base, modelSource, interfaceSource });
  assert.equal([...injected.fragment.matchAll(/<script>/g)].length, 2);
  assert.ok(injected.fragment.includes('\\u003c/script>'));
});
