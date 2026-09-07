import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ObusTransport } from '../ai/obus.mjs';
import { gameAiHostConfig } from './ai-services.mjs';
import { createHostScopeSource } from './scopes.mjs';

const flag = value => typeof value === 'boolean' ? value : null;

/** Read-only host diagnostics: no signer, registration, inference, audio or store migration. */
export async function collectGameHostDiagnostics({ env = process.env, transport,
  openScopeSource = createHostScopeSource, deadlineMs = 10000, now = Date.now } = {}) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 25 || deadlineMs > 30000) throw new TypeError('Invalid diagnostic deadline.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  let client;
  function bounded(job) {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new Error('Diagnostic deadline exceeded.'));
      controller.signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve(job).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
      if (controller.signal.aborted) aborted();
    });
  }
  let source, scopes = [], metadata = 'unavailable', capabilities = { reachable: false }, index = 0;
  const sessions = [];
  try {
    client = transport ?? new ObusTransport({ url: env.RAPHAEL_OBUS_URL || 'http://127.0.0.1:38175', serviceToken: env.RAPHAEL_OBUS_GAME_TOKEN,
      fetchImpl: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]) }) });
    try {
      source = openScopeSource({ ...gameAiHostConfig(env), env });
      scopes = source.listScopes(); metadata = 'ready';
    } catch { metadata = 'unavailable'; }
    finally { if (source) { try { source.close(); } catch { metadata = 'close-failed'; scopes = []; } } }
    const capabilityJob = (async () => {
      try {
        const value = await bounded(client.capabilities());
        capabilities = { reachable: true, contract: value.contract === 'raph-obus-game-v1' ? value.contract : null,
          campaignRag: flag(value.campaign_rag), providerAllowlist: flag(value.provider_allowlist), codexGate: flag(value.codex_gate),
          freeRoutes: flag(value.verified_free_route_fallback), codexAvailable: flag(value.codex_available),
          localSttReady: flag(value.local_stt?.route_ready) };
      } catch { capabilities = { reachable: false }; }
    })();
    async function worker() {
      while (index < scopes.length) {
        const offset = index++, scope = scopes[offset];
        const row = { campaign: scope.campaign, session: scope.session, authority: 'unavailable' };
        if (!controller.signal.aborted) {
          try {
            const value = await bounded(client.runtimeState({ campaign: scope.campaign }, scope.session));
            row.authority = value.generation === null ? 'missing' : typeof value.generation !== 'string' || !Number.isSafeInteger(value.leaseExpiresAtMs) ? 'unavailable' : value.leaseExpiresAtMs <= now() ? 'expired' : value.effectivePolicy?.enabled !== true ? 'disabled' : 'authorized';
            row.mode = ['local', 'local-free'].includes(value.effectivePolicy?.mode) ? value.effectivePolicy.mode : null;
            row.codex = flag(value.effectivePolicy?.codex);
          } catch { /* No raw transport errors, tokens, paths or server diagnostics leave this boundary. */ }
        }
        sessions[offset] = Object.freeze(row);
      }
    }
    await Promise.all([capabilityJob, ...Array.from({ length: Math.min(4, scopes.length) }, worker)]);
    return Object.freeze({ contract: 'raph-game-host-diagnostics-v1', readOnly: true, inference: 'not-run', metadata,
      deadlineExceeded: controller.signal.aborted, capabilities: Object.freeze(capabilities), sessions: Object.freeze(sessions) });
  } finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  collectGameHostDiagnostics().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.metadata !== 'ready' || !result.capabilities.reachable || result.sessions.some(row => row.authority !== 'authorized')) process.exitCode = 1;
  }).catch(() => { console.error('Game-host diagnostics could not complete.'); process.exitCode = 1; });
}
