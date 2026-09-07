import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, constants, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateConcentrationPersistence } from './concentration.mjs';
import { validateWorldTimePersistence } from './world-time.mjs';

export class BackupError extends Error {
  constructor(message) { super(message); this.code = 'BACKUP'; }
}
const invalid = () => { throw new BackupError('The backup is incomplete, inconsistent or unsupported. Keep the original database and inspect the host backup.'); };
function digest(file) {
  const fd = openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  try { for (;;) { const size = readSync(fd, buffer, 0, buffer.length, null); if (!size) break; hash.update(buffer.subarray(0, size)); } }
  finally { closeSync(fd); }
  return hash.digest('hex');
}
function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) invalid();
    const versions = db.prepare('SELECT version FROM game_schema').all();
    if (versions.length !== 1 || versions[0].version !== 1) invalid();
    const campaigns = db.prepare('SELECT id,revision,body FROM game_campaigns ORDER BY id').all();
    for (const row of campaigns) {
      const state = JSON.parse(row.body);
      try { validateConcentrationPersistence(state); } catch { invalid(); }
      if (state.campaign !== row.id || state.revision !== row.revision || !Number.isSafeInteger(row.revision) || row.revision < 1) invalid();
      const events = db.prepare('SELECT COUNT(*) AS n,MIN(revision) AS first,MAX(revision) AS last FROM game_events WHERE campaign=?').get(row.id);
      const frames = db.prepare("SELECT COUNT(*) AS n,MIN(revision) AS first,MAX(revision) AS last FROM game_outbox WHERE campaign=? AND kind='projection'").get(row.id);
      for (const ledger of [events, frames]) if (ledger.n !== row.revision || ledger.first !== 1 || ledger.last !== row.revision) invalid();
      const final = db.prepare("SELECT snapshot FROM game_outbox WHERE campaign=? AND revision=? AND kind='projection'").get(row.id, row.revision);
      if (JSON.stringify(JSON.parse(final.snapshot)) !== JSON.stringify(state)) invalid();
      // Reconnect can replay old projections, including interrupted resolutions.
      for (const frame of db.prepare("SELECT snapshot FROM game_outbox WHERE campaign=? AND kind='projection'").all(row.id)) {
        try { validateConcentrationPersistence(JSON.parse(frame.snapshot)); } catch { invalid(); }
      }
    }
    // Every retained action receipt must belong to a campaign and a committed
    // revision; restoring these identifiers is what makes command retries safe.
    for (const row of db.prepare('SELECT campaign,request,body FROM game_receipts').all()) {
      const receipt = JSON.parse(row.body), campaign = campaigns.find(c => c.id === row.campaign);
      if (!campaign || receipt.requestId !== row.request || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || receipt.revision > campaign.revision) invalid();
    }
    const worlds = [];
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='world_campaigns'").get()) {
      for (const row of db.prepare('SELECT campaign,revision,body FROM world_campaigns ORDER BY campaign').all()) {
        const state = JSON.parse(row.body), events = db.prepare('SELECT COUNT(*) AS n,MIN(revision) AS first,MAX(revision) AS last FROM world_events WHERE campaign=?').get(row.campaign);
        if (!campaigns.some(c => c.id === row.campaign) || state.revision !== row.revision || events.n !== row.revision || events.first !== 1 || events.last !== row.revision) invalid();
        worlds.push({ campaign: row.campaign, revision: row.revision, mission: state.mission.id, status: state.mission.status });
      }
      for (const row of db.prepare('SELECT campaign,owner,request,fingerprint,body FROM world_receipts').all()) {
        let receipt;
        try { receipt = JSON.parse(row.body); } catch { invalid(); }
        const world = worlds.find(w => w.campaign === row.campaign), campaign = campaigns.find(c => c.id === row.campaign);
        if (!world || !campaign || !receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.requestId !== row.request || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1) invalid();
        // Debriefs retain their original world revision. Adjudications bind both
        // ledgers; either marker requires the complete, supported receipt shape.
        const adjudicated = Object.hasOwn(receipt, 'worldRevision') || Object.hasOwn(receipt, 'outcomeId');
        const fields = adjudicated ? ['requestId', 'revision', 'worldRevision', 'missionId', 'outcomeId'] : ['requestId', 'revision', 'missionId'];
        if (Object.keys(receipt).length !== fields.length || !fields.every(field => Object.hasOwn(receipt, field))) invalid();
        const worldRevision = adjudicated ? receipt.worldRevision : receipt.revision;
        if (!Number.isSafeInteger(worldRevision) || worldRevision < 1 || worldRevision > world.revision || receipt.revision > (adjudicated ? campaign.revision : world.revision)) invalid();
        const eventRow = db.prepare('SELECT source,body FROM world_events WHERE campaign=? AND revision=?').get(row.campaign, worldRevision);
        let event;
        try { event = eventRow && JSON.parse(eventRow.body); } catch { invalid(); }
        if (!event || event.missionId !== receipt.missionId) invalid();
        let fingerprint;
        if (adjudicated) {
          const gameEvent = db.prepare('SELECT kind,body FROM game_events WHERE campaign=? AND revision=?').get(row.campaign, receipt.revision);
          let decision;
          try { decision = gameEvent && JSON.parse(gameEvent.body); } catch { invalid(); }
          const source = `game:${row.campaign}:${receipt.revision}`;
          if (typeof receipt.outcomeId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(receipt.outcomeId) || gameEvent?.kind !== 'mission_adjudicated' || decision?.missionId !== receipt.missionId || decision.outcomeId !== receipt.outcomeId || event.type !== 'mission_resolved' || event.result !== 'adjudicated' || event.outcomeId !== receipt.outcomeId || eventRow.source !== source || event.source !== source) invalid();
          fingerprint = ['adjudicateMission', receipt.revision - 1, worldRevision - 1, receipt.outcomeId];
        } else {
          if (event.type !== 'debrief_recorded' || event.recordedBy !== row.owner || typeof event.notes !== 'string') invalid();
          fingerprint = [worldRevision - 1, event.notes];
        }
        if (row.fingerprint !== createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex')) invalid();
      }
    }
    try { validateWorldTimePersistence(db); } catch { invalid(); }
    return { schema: 1, worlds, campaigns: campaigns.map(c => ({ id: c.id, revision: c.revision })),
      receipts: db.prepare('SELECT COUNT(*) AS n FROM game_receipts').get().n };
  } finally { db.close(); }
}

/** Host-only operation. Destination must be new; existing files are never replaced. */
export function backupGame(sourceFile, destinationDirectory) {
  const source = resolve(sourceFile), destination = resolve(destinationDirectory);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    mkdirSync(destination); // Atomic reservation; rejects even an empty existing directory.
    db.prepare('VACUUM INTO ?').run(join(destination, 'game.sqlite'));
  } finally { db.close(); }
  const file = join(destination, 'game.sqlite');
  const manifest = { format: 'raph-game-backup-v1', createdAt: new Date().toISOString(), sha256: digest(file), ...inspect(file) };
  // Manifest is written last. A partial backup cannot pass verification.
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

export function verifyGameBackup(directory) {
  const root = resolve(directory), raw = readFileSync(join(root, 'manifest.json'));
  if (raw.length > 1048576) invalid();
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.format !== 'raph-game-backup-v1' || manifest.sha256 !== digest(join(root, 'game.sqlite'))) invalid();
  const report = inspect(join(root, 'game.sqlite'));
  if (report.schema !== manifest.schema || report.receipts !== manifest.receipts || JSON.stringify(report.campaigns) !== JSON.stringify(manifest.campaigns)) invalid();
  if (JSON.stringify(report.worlds) !== JSON.stringify(manifest.worlds ?? [])) invalid();
  return manifest;
}

/** Restores into an unused data directory. Never swaps a running host's database. */
export function restoreGameBackup(directory, destinationDirectory) {
  const manifest = verifyGameBackup(directory), destination = resolve(destinationDirectory);
  mkdirSync(destination);
  const restored = join(destination, 'game.sqlite');
  copyFileSync(join(resolve(directory), 'game.sqlite'), restored, constants.COPYFILE_EXCL);
  if (digest(restored) !== manifest.sha256) invalid();
  const report = inspect(restored);
  return { status: 'restored_to_new_directory', ...report };
}
