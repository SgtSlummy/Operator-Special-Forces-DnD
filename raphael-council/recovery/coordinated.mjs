import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const STORE_NAMES = ['game', 'characters', 'chronicle', 'images'];
const FORMAT = 'raph-coordinated-checkpoint-v1';
export class RecoveryError extends Error { constructor(message) { super(message); this.code = 'RECOVERY'; } }
const fail = message => { throw new RecoveryError(message); };
const sha256 = file => { const fd = openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536); try { for (;;) { const n = readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0, n)); } } finally { closeSync(fd); } return hash.digest('hex'); };
const requireNew = directory => { const root = resolve(directory); if (existsSync(root)) fail('Checkpoint destination must be a new directory.'); mkdirSync(root, { recursive: false, mode: 0o700 }); return root; };
const sqliteSnapshot = (source, destination) => { const input = resolve(source); if (!existsSync(input) || !statSync(input).isFile()) fail('Required SQLite store is missing.'); const db = new DatabaseSync(input, { readOnly: true }); try { db.prepare('VACUUM INTO ?').run(destination); } finally { db.close(); } };
const inspectSqlite = file => { const db = new DatabaseSync(file, { readOnly: true }); try { const integrity = db.prepare('PRAGMA integrity_check').all(); if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('Checkpoint contains an invalid SQLite store.'); return { integrity: 'ok', bytes: statSync(file).size }; } finally { db.close(); } };
const assetEntries = root => { const base = resolve(root); if (!existsSync(base) || !statSync(base).isDirectory()) fail('Required asset directory is missing.'); const out = []; const walk = current => { for (const name of readdirSync(current, { withFileTypes: true })) { const file = join(current, name.name); if (name.isDirectory()) walk(file); else if (name.isFile()) out.push({ path: relative(base, file).replaceAll('\\', '/'), sha256: sha256(file), bytes: statSync(file).size }); else fail('Asset directory contains an unsupported entry.'); } }; walk(base); return out.sort((a, b) => a.path.localeCompare(b.path)); };
const copyAssets = (source, destination) => { mkdirSync(destination, { recursive: true, mode: 0o700 }); cpSync(resolve(source), destination, { recursive: true, errorOnExist: false, force: false }); };
const validateShape = manifest => { if (!manifest || manifest.format !== FORMAT || !manifest.campaign || !manifest.encounterId || !manifest.stores || !manifest.assets) fail('Checkpoint manifest is incomplete or unsupported.'); for (const name of STORE_NAMES) if (!manifest.stores[name]?.sha256) fail('Checkpoint is missing a required store.'); if (!Array.isArray(manifest.assets)) fail('Checkpoint asset manifest is invalid.'); };

export function createCoordinatedCheckpoint({ campaign, encounterId, stores, assetsDirectory, inspect = {}, assertCoherent = () => {} }, destinationDirectory) {
  if (typeof campaign !== 'string' || !campaign || typeof encounterId !== 'string' || !encounterId) fail('Campaign and encounter identity are required.');
  if (!stores || STORE_NAMES.some(name => typeof stores[name] !== 'string')) fail('All four required SQLite store paths are required.');
  const root = requireNew(destinationDirectory), copied = {}, metadata = {};
  try {
    for (const name of STORE_NAMES) { const file = join(root, `${name}.sqlite`); sqliteSnapshot(stores[name], file); inspectSqlite(file); copied[name] = { file: `${name}.sqlite`, sha256: sha256(file), bytes: statSync(file).size }; metadata[name] = typeof inspect[name] === 'function' ? inspect[name](file) : null; }
    const assetRoot = join(root, 'assets'); copyAssets(assetsDirectory, assetRoot); const assets = assetEntries(assetRoot);
    assertCoherent({ campaign, encounterId, stores: metadata, assets });
    const manifest = { format: FORMAT, schema: 1, campaign, encounterId, createdAt: new Date().toISOString(), stores: copied, assets };
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    return manifest;
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error instanceof RecoveryError ? error : new RecoveryError('Coordinated checkpoint failed before its manifest was written.'); }
}

export function verifyCoordinatedCheckpoint(directory) {
  const root = resolve(directory), manifestFile = join(root, 'manifest.json'); if (!existsSync(manifestFile)) fail('Checkpoint manifest is missing.');
  let manifest; try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch { fail('Checkpoint manifest is unreadable.'); } validateShape(manifest);
  for (const name of STORE_NAMES) { const file = join(root, manifest.stores[name].file); if (!existsSync(file) || sha256(file) !== manifest.stores[name].sha256) fail('Checkpoint store hash does not match its manifest.'); inspectSqlite(file); }
  const actual = assetEntries(join(root, 'assets')); if (JSON.stringify(actual) !== JSON.stringify(manifest.assets)) fail('Checkpoint assets do not match their manifest.'); return manifest;
}

export function restoreCoordinatedCheckpoint(directory, destinationDirectory, { assertCoherent = () => {} } = {}) {
  const manifest = verifyCoordinatedCheckpoint(directory), root = requireNew(destinationDirectory); try {
    for (const name of STORE_NAMES) copyFileSync(join(resolve(directory), manifest.stores[name].file), join(root, `${name}.sqlite`));
    copyAssets(join(resolve(directory), 'assets'), join(root, 'assets')); assertCoherent(manifest); writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); verifyCoordinatedCheckpoint(root); return { status: 'restored_to_new_directory', format: manifest.format, campaign: manifest.campaign, encounterId: manifest.encounterId };
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error instanceof RecoveryError ? error : new RecoveryError('Restore failed before activation; the original stores were not changed.'); }
}
