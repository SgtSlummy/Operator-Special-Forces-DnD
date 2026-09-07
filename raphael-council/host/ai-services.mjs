import { join } from 'node:path';
import { gameConfig } from '../game/storage.mjs';
import { chronicleConfig } from '../chronicle/storage.mjs';
import { createLocalObusHostControl } from '../ai/host-config.mjs';
import { createObusHostLifecycle } from '../ai/host-lifecycle.mjs';
import { createHostScopeSource } from './scopes.mjs';

const fail = code => Object.assign(new Error('The private game AI host is unavailable. Manual play remains available.'), { name: 'GameAiHostError', code });
const errorCode = error => ['INVALID_HOST_CONFIGURATION', 'HOST_START_ABORTED', 'HOST_CLOSE_FAILED'].includes(error?.code) ? error.code : 'OBUS_HOST_UNAVAILABLE';

/** Canonical paths only; this function never creates a database or reads credentials. */
export function gameAiHostConfig(env = process.env) {
  const raw = env.RAPHAEL_MEMBERSHIP_CAMPAIGNS;
  if (typeof raw !== 'string' || raw.length > 6500) throw fail('INVALID_HOST_CONFIGURATION');
  const campaigns = raw.split(',').map(value => value.trim());
  if (!campaigns.length || campaigns.length > 100 || campaigns.some(value => !/^[A-Za-z0-9_-]{1,64}$/.test(value)) || new Set(campaigns).size !== campaigns.length) throw fail('INVALID_HOST_CONFIGURATION');
  const chronicleFiles = Object.create(null);
  for (const campaign of campaigns) {
    const config = chronicleConfig(campaign, env);
    if (config.enabled) chronicleFiles[campaign] = join(config.dataDir, 'chronicle.sqlite');
  }
  return Object.freeze({ gameDatabasePath: join(gameConfig(env).dataDir, 'game.sqlite'), campaigns: Object.freeze(campaigns), chronicleFiles: Object.freeze(chronicleFiles) });
}

/**
 * Owns read-only metadata handles and game-host leases in the existing Obus runtime.
 * It does not start Obus, Davy Jones, a membership writer, a tunnel, or any model.
 * Configuration/provider failures return an unavailable handle so manual play can start.
 * The caller owns the returned handle, including when startup is cancelled or unavailable.
 */
export async function openGameAiHostServices({ env = process.env, signal,
  createScopeSource = createHostScopeSource,
  createControl = () => createLocalObusHostControl({ env }),
  createLifecycle = createObusHostLifecycle } = {}) {
  if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw fail('INVALID_HOST_CONFIGURATION');
  let source, lifecycle, startup, closing, state = 'starting', lastError = null;
  let lifecycleClosed = false, sourceClosed = false;
  function status() {
    let runtime = null;
    try { runtime = lifecycle?.status() ?? null; } catch {}
    return Object.freeze({ state, lastError, runtime });
  }
  async function cleanup() {
    // Keep the source alive until every lease operation has drained; only close owned handles.
    let failed = false;
    if (lifecycle && !lifecycleClosed) {
      try { await lifecycle.close(); lifecycleClosed = true; } catch { failed = true; }
    }
    if ((!lifecycle || lifecycleClosed) && source && !sourceClosed) {
      try { await source.close(); sourceClosed = true; } catch { failed = true; }
    }
    if (failed) { state = 'shutdown-incomplete'; lastError = 'HOST_CLOSE_FAILED'; throw fail(lastError); }
    state = 'closed';
    signal?.removeEventListener('abort', onAbort);
    return status();
  }
  function close() {
    if (state === 'closed') return Promise.resolve(status());
    if (!closing) {
      state = 'closing';
      closing = (async () => { await startup; return cleanup(); })().finally(() => { closing = null; });
    }
    return closing;
  }
  function onAbort() { void close().catch(() => {}); }
  const services = Object.freeze({ close, status });
  // Defer allocations until startup is assigned, including synchronous abort callbacks.
  startup = Promise.resolve().then(async () => {
    if (signal?.aborted) { lastError = 'HOST_START_ABORTED'; return; }
    try {
      const config = gameAiHostConfig(env);
      source = createScopeSource({ ...config, env });
      source.listScopes(); // Verify canonical campaigns before signing any Obus request.
      const control = createControl();
      lifecycle = createLifecycle({ control, listScopes: () => source.listScopes() });
      await lifecycle.start();
      if (state !== 'closing') state = 'running';
    } catch (error) {
      lastError = errorCode(error);
      if (state !== 'closing') state = 'unavailable';
    }
  });
  signal?.addEventListener('abort', onAbort, { once: true });
  await startup;
  if (signal?.aborted) await close().catch(() => {});
  return services;
}
