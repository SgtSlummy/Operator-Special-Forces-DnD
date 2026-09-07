import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { gameConfig } from '../game/storage.mjs';
import { characterConfig } from '../characters/runtime.mjs';
import { chronicleConfig } from '../chronicle/storage.mjs';
import { imageConfig } from '../images/runtime.mjs';
import { createCoordinatedCheckpoint, restoreCoordinatedCheckpoint } from './coordinated.mjs';

const isOneDrivePath = path => resolve(path).split(/[\\/]+/).some(part => /^onedrive(?:$|[ -])/i.test(part));
const localPath = path => { if (typeof path !== 'string' || !isAbsolute(path) || isOneDrivePath(path)) throw new Error('Recovery refuses OneDrive or non-absolute storage paths.'); return resolve(path); };

export function runtimeRecoverySources(campaign, env = process.env) {
  for (const key of ['RAPHAEL_GAME_DATA_DIR', 'RAPHAEL_DATA_DIR', 'RAPHAEL_CHRONICLE_DATA_DIR', 'RAPHAEL_IMAGE_DATA_DIR', 'RAPHAEL_ART_ROOT']) {
    if (env[key] !== undefined && (typeof env[key] !== 'string' || !isAbsolute(env[key]) || isOneDrivePath(env[key]))) throw new Error('Recovery refuses OneDrive or non-absolute storage paths.');
  }
  const game = gameConfig(env), characters = characterConfig(env), chronicle = chronicleConfig(campaign, env), images = imageConfig(env);
  return { stores: {
    game: localPath(join(game.dataDir, 'game.sqlite')),
    characters: localPath(join(characters.dataDir, 'characters.sqlite')),
    chronicle: localPath(join(chronicle.dataDir, 'chronicle.sqlite')),
    images: localPath(join(images.dataDir, 'images.sqlite')),
  }, assetsDirectory: localPath(images.artRoot) };
}

function inspect(path, query, params = []) {
  if (!existsSync(path)) throw new Error(`Required recovery store is missing: ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(query).all(...params); } finally { db.close(); }
}

export function runtimeInspectors(campaign, encounterId) {
  return {
    game: file => {
      const rows = inspect(file, 'SELECT id,revision,body FROM game_campaigns WHERE id=?', [campaign]);
      if (rows.length !== 1 || !Number.isSafeInteger(rows[0].revision) || rows[0].revision < 1 || !String(rows[0].body).includes(encounterId)) throw new Error('Game store does not contain the requested campaign and encounter identity.');
      return { campaign, revision: rows[0].revision, encounterId };
    },
    characters: file => {
      const rows = inspect(file, 'SELECT owner,revision FROM characters WHERE campaign=? ORDER BY owner', [campaign]);
      if (!rows.length || rows.some(row => !Number.isSafeInteger(row.revision) || row.revision < 1)) throw new Error('Approved character store has no valid pinned campaign revisions.');
      return { campaign, owners: rows.map(row => String(row.owner)), revisions: rows.map(row => row.revision) };
    },
    chronicle: file => {
      const rows = inspect(file, 'SELECT id,body FROM sessions WHERE campaign=?', [campaign]);
      if (!rows.length) throw new Error('Chronicle store has no session for the campaign.');
      return { campaign, sessions: rows.map(row => row.id) };
    },
    images: file => {
      const rows = inspect(file, 'SELECT audience,revision FROM scenes WHERE campaign=?', [campaign]);
      const revision = inspect(file, 'SELECT revision FROM revisions WHERE campaign=?', [campaign]);
      if (!rows.length || revision.length !== 1 || !Number.isSafeInteger(revision[0].revision)) throw new Error('Image store has no campaign scene projection.');
      return { campaign, audiences: rows.map(row => row.audience), revision: revision[0].revision };
    },
  };
}

export function createRuntimeCheckpoint({ campaign, encounterId, destinationDirectory, env = process.env, assertCoherent = () => {} }) {
  const source = runtimeRecoverySources(campaign, env);
  return createCoordinatedCheckpoint({ campaign, encounterId, ...source, inspect: runtimeInspectors(campaign, encounterId), assertCoherent }, destinationDirectory);
}

export function restoreRuntimeCheckpoint({ checkpointDirectory, destinationDirectory, assertCoherent = () => {} }) {
  return restoreCoordinatedCheckpoint(checkpointDirectory, destinationDirectory, { assertCoherent });
}
