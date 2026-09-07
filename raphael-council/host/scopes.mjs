import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const LIMIT = 100;
const campaignId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const sessionId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) && value !== 'campaign';
const oneDriveName = value => value.split(/[\\/]+/).some(part => /^onedrive(?:$|[ -])/i.test(part));
const within = (path, root) => { const value = relative(root, path); return value === '' || value.split(/[\\/]/)[0] !== '..' && !isAbsolute(value); };
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
function fail(code) { throw Object.assign(new Error('The private host scope source is unavailable or invalid.'), { name: 'HostScopeSourceError', code }); }
function safe(error) {
  const codes = ['INVALID_SCOPE_CONFIGURATION', 'SCOPE_SOURCE_PATH', 'SCOPE_SOURCE_SCHEMA', 'SCOPE_SOURCE_UNAVAILABLE', 'SCOPE_SOURCE_CHANGED', 'SCOPE_SOURCE_LIMIT', 'SCOPE_SOURCE_CLOSED', 'SCOPE_SOURCE_UNKNOWN_CAMPAIGN', 'SCOPE_SOURCE_CLOSE_FAILED'];
  const code = error?.name === 'HostScopeSourceError' && codes.includes(error.code) ? error.code : 'SCOPE_SOURCE_UNAVAILABLE';
  return Object.assign(new Error('The private host scope source is unavailable or invalid.'), { name: 'HostScopeSourceError', code });
}
function allowedCampaigns(value) {
  if (!Array.isArray(value) || !value.length || value.length > LIMIT || value.some(item => !campaignId(item)) || new Set(value).size !== value.length) fail('INVALID_SCOPE_CONFIGURATION');
  return [...value];
}
function roots(env, additional) {
  const values = [...additional, ...['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'].map(key => env[key]).filter(value => value !== undefined && value !== '')];
  return values.map(value => {
    if (typeof value !== 'string' || !isAbsolute(value)) fail('INVALID_SCOPE_CONFIGURATION');
    try { return realpathSync(value); } catch { return resolve(value); }
  });
}
function inspectPath(value, excluded, missingAllowed = false) {
  if (typeof value !== 'string' || !isAbsolute(value)) fail('INVALID_SCOPE_CONFIGURATION');
  const configured = resolve(value);
  let path, info;
  try { path = realpathSync(configured); info = statSync(path); }
  catch (error) {
    if (!missingAllowed || error.code !== 'ENOENT') fail('SCOPE_SOURCE_PATH');
    let cursor = configured; const tail = [];
    while (true) {
      try { path = join(realpathSync(cursor), ...tail.reverse()); break; }
      catch (failure) {
        if (failure.code !== 'ENOENT' || dirname(cursor) === cursor) fail('SCOPE_SOURCE_PATH');
        tail.push(basename(cursor)); cursor = dirname(cursor);
      }
    }
  }
  if (oneDriveName(configured) || oneDriveName(path) || excluded.some(root => within(configured, root) || within(path, root))) fail('SCOPE_SOURCE_PATH');
  if (!info) return { configured, path, exists: false };
  if (!info.isFile() || info.size < 16) fail('SCOPE_SOURCE_PATH');
  let handle;
  try {
    handle = openSync(path, 'r'); const header = Buffer.alloc(16);
    if (readSync(handle, header, 0, 16, 0) !== 16 || !header.equals(Buffer.from('SQLite format 3\0'))) fail('SCOPE_SOURCE_PATH');
  } finally { if (handle !== undefined) closeSync(handle); }
  return { configured, path, exists: true, device: info.dev, inode: info.ino, birth: info.birthtimeMs };
}
function sameFile(before, after) {
  return after.exists && pathKey(before.path) === pathKey(after.path) && before.device === after.device && before.inode === after.inode && before.birth === after.birth;
}
function table(db, name, columns) {
  if (db.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(name)?.type !== 'table') fail('SCOPE_SOURCE_SCHEMA');
  const present = new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row => row.name));
  if (columns.some(column => !present.has(column))) fail('SCOPE_SOURCE_SCHEMA');
}
function gameSchema(db) {
  table(db, 'game_schema', ['version']);
  const versions = db.prepare('SELECT version FROM game_schema').all();
  if (versions.length !== 1 || versions[0].version !== 1) fail('SCOPE_SOURCE_SCHEMA');
  table(db, 'game_campaigns', ['id', 'revision', 'body']); table(db, 'game_members', ['campaign', 'owner', 'role']);
}
function openReadOnly(info, kind) {
  let db;
  try {
    db = new DatabaseSync(info.path, { readOnly: true });
    if (kind === 'game') gameSchema(db);
    else table(db, 'sessions', ['id', 'campaign', 'body']);
    return { db, info };
  } catch (error) { try { db?.close(); } catch {} throw safe(error); }
}

/**
 * Read-only metadata source. Pass canonical game/chronicle paths from composition.
 * campaigns and chronicleFiles may be synchronous callbacks so revocation is fresh.
 * An empty chronicleFiles map means disabled; an initially absent file is explicitly
 * not-initialized and yields only campaign masters until the writer creates it.
 * No store constructors, schema writes, audio, evidence, or credentials are used.
 */
export function createHostScopeSource({ gameDatabasePath, chronicleFiles, campaigns, env = process.env, oneDriveRoots = [] } = {}) {
  if (!env || typeof env !== 'object' || !Array.isArray(oneDriveRoots) || !(Array.isArray(campaigns) || typeof campaigns === 'function') || !(chronicleFiles && typeof chronicleFiles === 'object' && !Array.isArray(chronicleFiles) || typeof chronicleFiles === 'function')) fail('INVALID_SCOPE_CONFIGURATION');
  const readCampaigns = () => allowedCampaigns(typeof campaigns === 'function' ? campaigns() : campaigns);
  let gameInfo, game;
  try {
    readCampaigns();
    gameInfo = inspectPath(gameDatabasePath, roots(env, oneDriveRoots));
    game = openReadOnly(gameInfo, 'game');
  } catch (error) { throw safe(error); }
  const chronicle = new Map(), knownPaths = new Map();
  let closed = false, ready = false, lastError = null, chronicleState = 'unchecked', scopeCount = 0;
  let initializedCampaigns = 0, missingCampaigns = 0, disabledCampaigns = 0;
  function status() {
    return Object.freeze({ closed, ready, lastError, scopeCount, chronicle: chronicleState, initializedCampaigns, missingCampaigns, disabledCampaigns, openChronicleFiles: chronicle.size });
  }
  function listScopes() {
    if (closed) fail('SCOPE_SOURCE_CLOSED');
    try {
      const allowed = readCampaigns(), excluded = roots(env, oneDriveRoots);
      if (!sameFile(gameInfo, inspectPath(gameDatabasePath, excluded))) fail('SCOPE_SOURCE_CHANGED');
      gameSchema(game.db);
      const files = typeof chronicleFiles === 'function' ? chronicleFiles() : chronicleFiles;
      if (!files || typeof files !== 'object' || Array.isArray(files)) fail('INVALID_SCOPE_CONFIGURATION');
      for (const campaign of knownPaths.keys()) if (!allowed.includes(campaign)) knownPaths.delete(campaign);
      const result = [], activeFiles = new Set(), seen = new Set();
      initializedCampaigns = 0; missingCampaigns = 0; disabledCampaigns = 0;
      // All masters precede every child, including when databases are shared.
      for (const campaign of allowed) {
        if (!game.db.prepare('SELECT id FROM game_campaigns WHERE id=?').get(campaign)) fail('SCOPE_SOURCE_UNKNOWN_CAMPAIGN');
        result.push(Object.freeze({ campaign, session: 'campaign' }));
      }
      for (const campaign of allowed) {
        if (!Object.hasOwn(files, campaign)) { knownPaths.delete(campaign); disabledCampaigns++; continue; }
        const descriptor = Object.getOwnPropertyDescriptor(files, campaign);
        if (!Object.hasOwn(descriptor, 'value')) fail('INVALID_SCOPE_CONFIGURATION');
        const info = inspectPath(descriptor.value, excluded, true);
        const previous = knownPaths.get(campaign);
        if (previous && pathKey(previous.configured) === pathKey(info.configured) && !sameFile(previous, info)) fail('SCOPE_SOURCE_CHANGED');
        if (!info.exists) { missingCampaigns++; continue; }
        const actualKey = pathKey(info.path); activeFiles.add(actualKey);
        let source = chronicle.get(actualKey);
        if (source && !sameFile(source.info, info)) fail('SCOPE_SOURCE_CHANGED');
        if (!source) { source = openReadOnly(info, 'chronicle'); chronicle.set(actualKey, source); }
        knownPaths.set(campaign, info); initializedCampaigns++;
        const invalid = source.db.prepare("SELECT 1 FROM sessions WHERE campaign=? AND (json_valid(body)=0 OR json_extract(body,'$.status') IS NULL OR json_extract(body,'$.status') NOT IN ('active','paused','ending','ended')) LIMIT 1").get(campaign);
        if (invalid) fail('SCOPE_SOURCE_SCHEMA');
        const rows = source.db.prepare("SELECT id,campaign,json_extract(body,'$.id') AS bodyId,json_extract(body,'$.campaign') AS bodyCampaign,json_extract(body,'$.host') AS host FROM sessions WHERE campaign=? AND json_extract(body,'$.status') IN ('active','paused','ending') ORDER BY id LIMIT 101").all(campaign);
        if (rows.length > LIMIT) fail('SCOPE_SOURCE_LIMIT');
        for (const row of rows) {
          if (!sessionId(row.id) || row.bodyId !== row.id || row.campaign !== campaign || row.bodyCampaign !== campaign || typeof row.host !== 'string' || !row.host.length || row.host.length > 100) fail('SCOPE_SOURCE_SCHEMA');
          if (game.db.prepare('SELECT role FROM game_members WHERE campaign=? AND owner=?').get(campaign, row.host)?.role !== 'host') continue;
          const scopeKey = `${campaign}/${row.id}`;
          if (seen.has(scopeKey)) continue;
          seen.add(scopeKey); result.push(Object.freeze({ campaign, session: row.id }));
          if (result.length > LIMIT) fail('SCOPE_SOURCE_LIMIT');
        }
      }
      for (const [key, source] of chronicle) {
        if (!activeFiles.has(key)) { source.db.close(); chronicle.delete(key); }
      }
      chronicleState = initializedCampaigns ? missingCampaigns || disabledCampaigns ? 'partial' : 'ready' : missingCampaigns ? 'not-initialized' : 'disabled';
      scopeCount = result.length; ready = true; lastError = null;
      return Object.freeze(result);
    } catch (error) {
      for (const source of chronicle.values()) { try { source.db.close(); } catch {} }
      chronicle.clear();
      ready = false; scopeCount = 0; chronicleState = 'unavailable'; lastError = safe(error).code;
      throw safe(error);
    }
  }
  function close() {
    if (closed) return status();
    closed = true; ready = false; scopeCount = 0;
    let failed = false;
    for (const source of chronicle.values()) { try { source.db.close(); } catch { failed = true; } }
    chronicle.clear(); knownPaths.clear();
    try { game.db.close(); } catch { failed = true; }
    if (failed) { lastError = 'SCOPE_SOURCE_CLOSE_FAILED'; fail(lastError); }
    return status();
  }
  return Object.freeze({ listScopes, close, status });
}
