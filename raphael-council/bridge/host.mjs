import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GameStore } from '../game/store.mjs';
import { gameConfig } from '../game/storage.mjs';
import { startMembershipBridge } from './server.mjs';

const service = 'operator-membership';
const invalid = () => new Error('Membership bridge configuration is invalid. Check the private token, campaign allowlist, port and existing game database.');
const under = (path, root) => { const remainder = relative(root, path); return remainder === '' || !isAbsolute(remainder) && !/^\.\.(?:[\\/]|$)/.test(remainder); };
const oneDriveName = path => path.split(/[\\/]+/).some(part => /^onedrive(?:$|[ -])/i.test(part));

function boundedFile(path, maximum) {
  let handle;
  try {
    handle = openSync(path, 'r');
    const bytes = Buffer.alloc(maximum + 1);
    const count = readSync(handle, bytes, 0, bytes.length, 0);
    if (count > maximum) throw invalid();
    return bytes.subarray(0, count);
  } finally { if (handle !== undefined) closeSync(handle); }
}

/** Filesystem-only validation: never opens SQLite, migrates, creates files or listens. */
export function membershipHostConfig(env = process.env) {
  try {
    const rawPort = env.RAPHAEL_MEMBERSHIP_PORT ?? '38176';
    if (typeof rawPort !== 'string' || !/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535) throw invalid();
    const rawCampaigns = env.RAPHAEL_MEMBERSHIP_CAMPAIGNS;
    if (typeof rawCampaigns !== 'string') throw invalid();
    const campaigns = rawCampaigns.split(',').map(value => value.trim());
    if (campaigns.length < 1 || campaigns.length > 100 || new Set(campaigns).size !== campaigns.length || campaigns.some(value => !/^[A-Za-z0-9_-]{1,64}$/.test(value))) throw invalid();
    const inline = env.RAPHAEL_MEMBERSHIP_TOKEN, tokenFile = env.RAPHAEL_MEMBERSHIP_TOKEN_FILE;
    if ((inline !== undefined) === (tokenFile !== undefined)) throw invalid();
    let token = inline;
    if (tokenFile !== undefined) {
      if (typeof tokenFile !== 'string' || !isAbsolute(tokenFile) || !statSync(tokenFile).isFile()) throw invalid();
      // A text file may end with one newline; whitespace inside the token is invalid.
      token = boundedFile(realpathSync(tokenFile), 514).toString('utf8').replace(/\r?\n$/, '');
    }
    if (typeof token !== 'string' || !/^[!-~]{32,512}$/.test(token)) throw invalid();
    const configured = join(gameConfig(env).dataDir, 'game.sqlite');
    const databasePath = realpathSync(configured), info = statSync(databasePath);
    if (!info.isFile() || info.size < 16 || oneDriveName(configured) || oneDriveName(databasePath)) throw invalid();
    for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
      if (!env[key] || typeof env[key] !== 'string' || !isAbsolute(env[key])) continue;
      let root = resolve(env[key]);
      try { root = realpathSync(root); } catch { /* A nonexistent sync root still has its configured boundary. */ }
      if (under(databasePath, root)) throw invalid();
    }
    let handle;
    try {
      handle = openSync(databasePath, 'r');
      const header = Buffer.alloc(16);
      if (readSync(handle, header, 0, 16, 0) !== 16 || !header.equals(Buffer.from('SQLite format 3\0'))) throw invalid();
    } finally { if (handle !== undefined) closeSync(handle); }
    const config = { databasePath, campaigns: Object.freeze(campaigns), port: Number(rawPort) };
    // Accidental serialization of configuration must not reveal the service token.
    Object.defineProperty(config, 'token', { value: token });
    return Object.freeze(config);
  } catch { throw invalid(); }
}

/** Explicit start only. This process owns one dedicated GameStore connection. */
export async function startMembershipHost({ env = process.env, openGame = path => new GameStore(path), startBridge = startMembershipBridge } = {}) {
  const config = membershipHostConfig(env);
  let game;
  try {
    // Configuration and opening are synchronous with no intervening asynchronous work.
    game = openGame(config.databasePath);
    const bridge = await startBridge({ game, token: config.token, campaigns: config.campaigns, port: config.port });
    let closing;
    return Object.freeze({
      url: bridge.url,
      close() {
        if (!closing) closing = (async () => {
          try { await bridge.close(); game.close(); }
          catch { throw new Error('Membership bridge cleanup did not finish.'); }
        })();
        return closing;
      },
    });
  } catch {
    try { game?.close(); } catch { /* Never print database paths, tokens or driver errors. */ }
    throw new Error('Membership bridge could not start.');
  }
}

/** The CLI owns signal hooks; importing the module has no startup side effects. */
export async function runMembershipHost({ args = process.argv.slice(2), env = process.env, signals = process,
  write = value => process.stdout.write(`${JSON.stringify(value)}\n`), start = startMembershipHost } = {}) {
  let startedHost, detach = () => {};
  const report = value => { try { write(value); } catch { /* Diagnostic sinks never expose raw exceptions. */ } };
  try {
    if (!Array.isArray(args) || args.length > 1 || args.length === 1 && args[0] !== '--check') throw invalid();
    if (args[0] === '--check') {
      const config = membershipHostConfig(env);
      report({ ready: true, service, version: 1, mode: 'check', listening: false, campaigns: config.campaigns.length, port: config.port });
      return { code: 0 };
    }
    const host = await start({ env }); startedHost = host;
    let stopping;
    const close = () => {
      if (!stopping) stopping = (async () => {
        try { await host.close(); report({ ready: false, service, stopped: true }); return 0; }
        catch { report({ ready: false, service, error: 'Membership bridge cleanup did not finish.' }); return 1; }
        finally { detach(); }
      })();
      return stopping;
    };
    const onSignal = () => { void close().then(code => { if (signals === process) process.exitCode = code; }); };
    detach = () => { signals.off('SIGINT', onSignal); signals.off('SIGTERM', onSignal); };
    signals.on('SIGINT', onSignal); signals.on('SIGTERM', onSignal);
    report({ ready: true, service, version: 1, mode: 'running', listening: true, url: host.url });
    return { code: 0, url: host.url, close };
  } catch {
    try { detach(); } catch { /* Remove only hooks this host registered. */ }
    try { await startedHost?.close(); } catch { /* Startup cleanup errors are never logged verbatim. */ }
    report({ ready: false, service, error: 'Membership bridge configuration or startup failed.' });
    return { code: 1 };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await runMembershipHost();
  process.exitCode = result.code;
}
