import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCoordinatedCheckpoint, verifyCoordinatedCheckpoint, restoreCoordinatedCheckpoint } from './coordinated.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'raph-coordinated-'));
  const source = join(root, 'source'), assets = join(source, 'assets'); mkdirSync(assets, { recursive: true });
  const stores = {};
  for (const name of ['game', 'characters', 'chronicle', 'images']) {
    const file = join(source, `${name}.sqlite`), db = new DatabaseSync(file);
    db.exec('CREATE TABLE marker(value TEXT);'); db.prepare('INSERT INTO marker VALUES(?)').run(name); db.close(); stores[name] = file;
  }
  writeFileSync(join(assets, 'scene.txt'), 'observable asset');
  return { root, stores, assets };
}

test('checkpoint verifies all stores and assets, then restores into a new directory', () => {
  const f = fixture();
  try {
    const backup = join(f.root, 'backup'), restored = join(f.root, 'restored');
    const manifest = createCoordinatedCheckpoint({ campaign: 'camp-1', encounterId: 'enc-1', stores: f.stores, assetsDirectory: f.assets,
      assertCoherent: value => assert.equal(value.campaign, 'camp-1') }, backup);
    assert.equal(manifest.format, 'raph-coordinated-checkpoint-v1'); assert.equal(Object.keys(manifest.stores).length, 4); assert.equal(manifest.assets.length, 1);
    assert.deepEqual(verifyCoordinatedCheckpoint(backup), manifest); assert.equal(restoreCoordinatedCheckpoint(backup, restored).status, 'restored_to_new_directory'); verifyCoordinatedCheckpoint(restored);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('coherence failure removes only the new destination', () => {
  const f = fixture();
  try {
    const backup = join(f.root, 'rejected');
    assert.throws(() => createCoordinatedCheckpoint({ campaign: 'camp-1', encounterId: 'enc-1', stores: f.stores, assetsDirectory: f.assets, assertCoherent: () => { throw new Error('mismatch'); } }, backup));
    assert.equal(existsSync(backup), false); assert.equal(existsSync(f.stores.game), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
