import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url));

/**
 * Owns only its child and injected private services; construction is inert.
 * openHostServices({ signal }) must roll back before rejecting, or return an owned
 * handle, even after cancellation. handle.close({ signal }) must resolve only when
 * quiescent and permit retry after rejection. Cancellation is cooperative: a hung
 * operation remains observed and prevents completion; it is never assumed stopped.
 * Running means process launch, not HTTP readiness. done resolves only on quiescence.
 */
export function createWebHostSupervisor({ mode = 'start', args = [], env = process.env, cwd = appDirectory,
  spawnImpl = spawn, openHostServices = async () => null, signals = process,
  report = message => console.error(message), onExit = code => { process.exitCode = code; },
  shutdownTimeoutMs = 5000, startupTimeoutMs = 30000 } = {}) {
  const validTimeout = value => Number.isSafeInteger(value) && value >= 50 && value <= 30000;
  if (!['dev', 'build', 'start'].includes(mode) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string') ||
      typeof spawnImpl !== 'function' || typeof openHostServices !== 'function' || typeof report !== 'function' || typeof onExit !== 'function' ||
      typeof signals?.on !== 'function' || typeof signals?.removeListener !== 'function' ||
      !validTimeout(shutdownTimeoutMs) || !validTimeout(startupTimeoutMs)) throw new TypeError('Invalid game-host launch options.');
  const commandArgs = [cli, mode, ...args], childEnv = { ...env, RAPHAEL_LOCAL_HOST: '1' };
  const startupController = new AbortController();
  let child = null, services = null, startup, opening, shutdown, serviceClose, serviceController;
  let closing = false, openingPending = false, childExited = false, invalidOwnership = false, needsCleanup = false;
  let state = 'idle', exitCode = null, finishChild, finishDone;
  const childDone = new Promise(resolve => { finishChild = resolve; });
  const done = new Promise(resolve => { finishDone = resolve; });
  const status = () => Object.freeze({ state, mode, pid: child?.pid ?? null, exitCode,
    readiness: 'unverified', quiesced: state === 'closed', startupPending: openingPending,
    childRunning: Boolean(child && !childExited), servicesPending: Boolean(services), servicesClosing: Boolean(serviceClose) });
  const warn = message => { try { report(message); } catch { /* Reporting cannot interrupt cleanup. */ } };
  const signalStop = () => { void close(); };
  function detachSignals() { signals.removeListener('SIGINT', signalStop); signals.removeListener('SIGTERM', signalStop); }

  // A deadline ends this caller's wait, not ownership of the underlying operation.
  function waitFor(promise, milliseconds, signal, expired = () => {}) {
    return new Promise((resolve, reject) => {
      let settled = false, timeout;
      const finish = (value, error = false) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', aborted);
        if (error) reject(value); else resolve(value);
      };
      const aborted = () => finish(new Error('Game-host operation cancelled.'), true);
      signal?.addEventListener('abort', aborted, { once: true });
      timeout = setTimeout(() => { finish(new Error('Game-host operation deadline exceeded.'), true); expired(); }, Math.max(0, milliseconds));
      Promise.resolve(promise).then(value => finish(value), error => finish(error, true));
      if (signal?.aborted) aborted();
    });
  }

  function finishIfQuiescent() {
    if (!closing || state === 'closed' || openingPending || services || serviceClose || invalidOwnership || child && !childExited) return false;
    child?.removeListener('spawn', spawned); child?.removeListener('error', childError); child?.removeListener('exit', exited);
    state = 'closed'; exitCode ??= 0;
    try { onExit(exitCode); } catch { warn('The game host could not report its final exit status.'); }
    finishDone(status()); return true;
  }
  function cleanLateResources() {
    if (!closing || state === 'closed') return;
    needsCleanup = true;
    if (!shutdown) queueMicrotask(() => { if (!shutdown && state !== 'closed') void close(); });
  }
  function exited(code) {
    if (childExited) return;
    childExited = true; finishChild();
    if (!closing) exitCode = Number.isInteger(code) ? code : 1;
    if (closing) finishIfQuiescent(); else void close();
  }
  function childError() {
    exitCode = 1; warn('The owned game web process reported an error.');
    // A spawn failure has no PID. Errors from an existing child do not prove exit.
    if (child?.pid == null) exited(1); else if (!closing) void close();
  }
  function spawned() { if (!closing) state = 'running'; }

  function start() {
    if (startup) return startup;
    if (closing) return Promise.reject(new Error('The game host has already closed.'));
    state = 'starting';
    startup = Promise.resolve().then(async () => {
      if (closing) return status();
      signals.on('SIGINT', signalStop); signals.on('SIGTERM', signalStop);
      // Builds never open stores, load host keys or register an Obus generation.
      if (mode !== 'build') {
        openingPending = true;
        opening = Promise.resolve().then(() => openHostServices({ signal: startupController.signal })).then(handle => {
          openingPending = false;
          if (handle !== null && (typeof handle !== 'object' || typeof handle.close !== 'function')) {
            invalidOwnership = true; throw new Error('Invalid host services.');
          }
          services = handle; cleanLateResources(); return handle;
        }, error => { openingPending = false; finishIfQuiescent(); throw error; });
        await waitFor(opening, startupTimeoutMs, startupController.signal, () => startupController.abort());
      }
      if (closing) return status();
      child = spawnImpl(process.execPath, commandArgs, { cwd, env: childEnv, stdio: 'inherit', windowsHide: true });
      if (!child || typeof child.once !== 'function' || typeof child.on !== 'function' || typeof child.kill !== 'function' || typeof child.removeListener !== 'function') {
        invalidOwnership = Boolean(child); throw new Error('Invalid web process.');
      }
      child.once('spawn', spawned); child.on('error', childError); child.once('exit', exited);
      return status();
    });
    void startup.catch(() => {
      if (!closing) { exitCode = 1; warn('The local game host could not start. Check its private configuration.'); void close(); }
    });
    return startup;
  }

  function beginServiceClose() {
    if (serviceClose || !services) return serviceClose;
    const owned = services;
    serviceController = new AbortController();
    serviceClose = Promise.resolve().then(() => owned.close({ signal: serviceController.signal })).then(() => {
      if (services === owned) services = null;
      serviceClose = null; serviceController = null; finishIfQuiescent(); return true;
    }, () => {
      serviceClose = null; serviceController = null; exitCode = 1;
      warn('Private game-host services could not fully close. Cleanup can be retried.'); return false;
    });
    return serviceClose;
  }

  function close() {
    if (shutdown) return shutdown;
    if (state === 'closed') return Promise.resolve(status());
    closing = true; state = 'stopping'; needsCleanup = false; detachSignals(); startupController.abort();
    const deadline = Date.now() + shutdownTimeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    shutdown = Promise.resolve().then(async () => {
      if (openingPending) {
        try { await waitFor(opening, remaining()); }
        catch { /* Pending preparation remains owned and observed after this wait. */ }
      }
      const stops = [];
      if (child && !childExited && !invalidOwnership) {
        try {
          const accepted = child.kill('SIGTERM');
          if (!accepted && !childExited) warn('The owned game web process did not accept termination; its exit is still being observed.');
        } catch { exitCode = 1; warn('The owned game web process could not be stopped. Cleanup can be retried.'); }
        stops.push(waitFor(childDone, remaining()).catch(() => {
          exitCode = 1; warn('The owned game web process did not stop before the shutdown deadline.');
        }));
      }
      const cleanup = beginServiceClose();
      if (cleanup) stops.push(waitFor(cleanup, remaining(), undefined, () => serviceController?.abort()).catch(() => {
        exitCode = 1; warn('Private game-host cleanup reached its deadline; outstanding work is still being observed.');
      }));
      await Promise.all(stops);
      if (!finishIfQuiescent() && state !== 'closed') {
        state = 'shutdown-incomplete'; exitCode = 1;
        warn('Game-host shutdown is incomplete. Owned resources remain observable; retry cleanup after they can stop.');
      }
      return status();
    }).finally(() => {
      shutdown = null;
      if (needsCleanup && state !== 'closed') queueMicrotask(() => { if (!shutdown) void close(); });
    });
    return shutdown;
  }
  return Object.freeze({ start, close, status, done });
}
