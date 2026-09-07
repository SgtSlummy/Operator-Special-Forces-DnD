import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeInspectors } from './runtime.mjs';

function db(file, schema, rows) { const d = new DatabaseSync(file); d.exec(schema); for (const [sql, values] of rows) d.prepare(sql).run(...values); d.close(); }

test('runtime inspectors require coherent campaign records across all stores', () => {
  const root = mkdtempSync(join(tmpdir(), 'raph-runtime-recovery-'));
  try {
    const files = Object.fromEntries(['game', 'characters', 'chronicle', 'images'].map(name => [name, join(root, `${name}.sqlite`)]));
    db(files.game, 'CREATE TABLE game_campaigns(id TEXT,revision INTEGER,body TEXT);', [['INSERT INTO game_campaigns VALUES(?,?,?)', ['camp-1', 4, '{"encounterId":"enc-1"}']]]);
    db(files.characters, 'CREATE TABLE characters(campaign TEXT,owner TEXT,revision INTEGER);', [['INSERT INTO characters VALUES(?,?,?)', ['camp-1', '1', 2]]]);
    db(files.chronicle, 'CREATE TABLE sessions(id TEXT,campaign TEXT,body TEXT);', [['INSERT INTO sessions VALUES(?,?,?)', ['session-1', 'camp-1', '{}']]]);
    db(files.images, 'CREATE TABLE scenes(campaign TEXT,audience TEXT,revision INTEGER,body TEXT); CREATE TABLE revisions(campaign TEXT,revision INTEGER);', [['INSERT INTO scenes VALUES(?,?,?,?)', ['camp-1', '1', 3, '{}']], ['INSERT INTO revisions VALUES(?,?)', ['camp-1', 3]]]);
    const inspectors = runtimeInspectors('camp-1', 'enc-1');
    const metadata = Object.fromEntries(Object.entries(inspectors).map(([name, inspect]) => [name, inspect(files[name])]));
    assert.deepEqual(metadata.game, { campaign: 'camp-1', revision: 4, encounterId: 'enc-1' });
    assert.deepEqual(metadata.characters.owners, ['1']); assert.deepEqual(metadata.chronicle.sessions, ['session-1']); assert.equal(metadata.images.revision, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('runtime inspectors reject an encounter that is not in the game ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'raph-runtime-recovery-'));
  try {
    const file = join(root, 'game.sqlite'); db(file, 'CREATE TABLE game_campaigns(id TEXT,revision INTEGER,body TEXT);', [['INSERT INTO game_campaigns VALUES(?,?,?)', ['camp-1', 1, '{}']]]);
    assert.throws(() => runtimeInspectors('camp-1', 'enc-1').game(file), /campaign and encounter identity/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
