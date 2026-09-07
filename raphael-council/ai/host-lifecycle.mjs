import { randomUUID } from 'node:crypto';

const CONTRACT = 'raph-obus-game-runtime-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INTERVAL_MS = 10000;
const MAX_SCOPES = 100;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && UUID.test(value);
const scopeKey = scope => `${scope.campaign}/${scope.session}`;
function fail(code) { throw Object.assign(new Error('Obus host lifecycle could not complete the operation.'), { name: 'ObusHostLifecycleError', code }); }
function reason(error) {
  if (error?.name === 'ObusHostLifecycleError' && ['INVALID_RUNTIME', 'INVALID_SCOPES', 'SCOPE_LIMIT', 'INVALID_CLOCK', 'INVALID_UUID'].includes(error.code)) return error.code;
  return error?.code === 'OBUS_HOST_CONTROL_CONFLICT' ? 'CONTROL_CONFLICT' : 'CONTROL_UNAVAILABLE';
}
function scopes(values) {
  if (!Array.isArray(values) || values.length > MAX_SCOPES) fail('INVALID_SCOPES');
  const result = new Map();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SCOPES');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== 2 || !descriptors.campaign || !descriptors.session || !Object.hasOwn(descriptors.campaign, 'value') || !Object.hasOwn(descriptors.session, 'value')) fail('INVALID_SCOPES');
    const { campaign, session } = value;
    if (typeof campaign !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(campaign) || typeof session !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(session)) fail('INVALID_SCOPES');
    const scope = Object.freeze({ campaign, session });
    result.set(scopeKey(scope), scope);
  }
  for (const scope of result.values()) if (!result.has(`${scope.campaign}/campaign`)) fail('INVALID_SCOPES');
  return new Map([...result].sort(([, a], [, b]) => Number(b.session === 'campaign') - Number(a.session === 'campaign')));
}
function snapshot(value, read = false) {
  if (!value || value.contract !== CONTRACT || !identifier(value.bootEpoch) || !(value.generation === null || identifier(value.generation)) || !integer(value.sessionPolicyRevision)) fail('INVALID_RUNTIME');
  if (value.generation === null ? value.leaseExpiresAtMs !== null : !integer(value.leaseExpiresAtMs)) fail('INVALID_RUNTIME');
  const policy = value.effectivePolicy;
  if (!policy || typeof policy.enabled !== 'boolean' || !['local', 'local-free'].includes(policy.mode) || typeof policy.exportable !== 'boolean' || policy.codex !== false || policy.tools !== false || policy.personalMemory !== false || policy.autoMemory !== false) fail('INVALID_RUNTIME');
  if (read && (value.requiredForRoute !== true || !integer(value.queuedCount) || !integer(value.dispatchedCount))) fail('INVALID_RUNTIME');
  return { bootEpoch: value.bootEpoch, generation: value.generation, sessionPolicyRevision: value.sessionPolicyRevision, leaseExpiresAtMs: value.leaseExpiresAtMs, effectivePolicy: { enabled: policy.enabled, mode: policy.mode, exportable: policy.exportable, codex: false } };
}

/** Owns only its timer and scoped game-host leases. Construction has no side effects. */
export function createObusHostLifecycle({ control, listScopes, now = Date.now, uuid = randomUUID, timers = { setTimeout, clearTimeout } } = {}) {
  if (!control || ['getRuntime', 'register', 'renew', 'configure', 'revoke'].some(name => typeof control[name] !== 'function') || typeof listScopes !== 'function' || typeof now !== 'function' || typeof uuid !== 'function' || typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') fail('INVALID_CONFIGURATION');
  const records = new Map();
  let state = 'idle', generation = null, activeWork = null, startWork = null, closeWork = null, timer = null;
  let lastTickAt = null, lastError = null;
  const clock = () => { const value = now(); if (!integer(value)) fail('INVALID_CLOCK'); return value; };
  const nextId = () => { const value = uuid(); if (!identifier(value)) fail('INVALID_UUID'); return value; };
  const stopping = () => state === 'closing' || state === 'closed';
  const mark = (record, next, code = null) => { record.state = next; record.reason = code; };
  function status() {
    return Object.freeze({ state, generation, busy: activeWork !== null || (state === 'closing'), lastTickAt, lastError,
      scopes: Object.freeze([...records.values()].map(record => Object.freeze({ ...record.scope, state: record.state, reason: record.reason, leaseExpiresAtMs: record.leaseExpiresAtMs }))),
    });
  }
  function clearTimer() {
    if (timer === null) return;
    const owned = timer; timer = null;
    try { timers.clearTimeout(owned); } catch { lastError = 'TIMER_UNAVAILABLE'; }
  }
  function schedule() {
    if (state !== 'running' || timer !== null) return;
    try { timer = timers.setTimeout(() => { timer = null; void tick().catch(() => {}); }, INTERVAL_MS); }
    catch { lastError = 'TIMER_UNAVAILABLE'; }
  }
  function owned(record, value) {
    if (value.bootEpoch !== record.bootEpoch || value.generation !== generation) return 'AUTHORITY_REPLACED';
    if (value.leaseExpiresAtMs === null || value.leaseExpiresAtMs <= clock()) return 'LEASE_EXPIRED';
    return null;
  }
  function accept(record, value, expectedRevision) {
    const rejection = owned(record, value);
    if (rejection || (expectedRevision !== undefined && value.sessionPolicyRevision !== expectedRevision)) fail('INVALID_RUNTIME');
    record.leaseExpiresAtMs = value.leaseExpiresAtMs;
    mark(record, 'active');
  }
  async function reconcileRecord(record) {
    if (stopping() || ['lost', 'retired'].includes(record.state)) return;
    if (record.scope.session !== 'campaign') {
      const master = records.get(`${record.scope.campaign}/campaign`);
      if (!master || ['lost', 'retired'].includes(master.state)) { mark(record, 'lost', 'MASTER_UNAVAILABLE'); return; }
      if (master.state !== 'active') { mark(record, 'pending', 'MASTER_UNAVAILABLE'); return; }
    }
    if (record.leaseExpiresAtMs !== null && record.leaseExpiresAtMs <= clock()) { mark(record, 'lost', 'LEASE_EXPIRED'); return; }
    let current;
    try { current = snapshot(await control.getRuntime(record.scope), true); }
    catch (error) { mark(record, error?.code === 'INVALID_RUNTIME' ? 'lost' : 'unavailable', reason(error)); return; }
    if (stopping()) return;
    if (record.attempted) {
      const rejection = owned(record, current);
      if (rejection) { mark(record, 'lost', rejection); return; }
      record.leaseExpiresAtMs = current.leaseExpiresAtMs;
      try {
        const result = snapshot(await control.renew({ ...record.scope, generation, expectedBootEpoch: record.bootEpoch, expectedSessionPolicyRevision: current.sessionPolicyRevision, opId: nextId(), leaseSeconds: 30 }));
        accept(record, result, current.sessionPolicyRevision);
        if (JSON.stringify(result.effectivePolicy) !== JSON.stringify(current.effectivePolicy)) fail('INVALID_RUNTIME');
      } catch (error) { mark(record, error?.code === 'INVALID_RUNTIME' ? 'lost' : 'unavailable', reason(error)); }
      return;
    }
    // Register once for a newly discovered scope. An uncertain write is never retried.
    // A later GET may only adopt the same live boot/generation before renewing it.
    if (current.generation === generation) { mark(record, 'lost', 'GENERATION_COLLISION'); return; }
    record.bootEpoch = current.bootEpoch;
    record.attempted = true;
    try {
      const result = snapshot(await control.register({ ...record.scope, generation, expectedBootEpoch: current.bootEpoch, expectedGeneration: current.generation, opId: nextId(), leaseSeconds: 30 }));
      accept(record, result);
    } catch (error) { mark(record, error?.code === 'INVALID_RUNTIME' ? 'lost' : 'unavailable', reason(error)); }
  }
  async function disable(record) {
    if (!record.attempted || ['lost', 'retired'].includes(record.state)) { if (record.state !== 'lost') mark(record, 'retired'); return; }
    try {
      const current = snapshot(await control.getRuntime(record.scope), true);
      const rejection = owned(record, current);
      if (rejection) { mark(record, 'lost', rejection); return; }
      if (record.scope.session !== 'campaign') {
        const result = snapshot(await control.revoke({ ...record.scope, generation, expectedBootEpoch: record.bootEpoch,
          expectedSessionPolicyRevision: current.sessionPolicyRevision, opId: nextId() }));
        if (result.bootEpoch !== record.bootEpoch || result.generation !== null || result.leaseExpiresAtMs !== null || result.sessionPolicyRevision !== current.sessionPolicyRevision + 1) fail('INVALID_RUNTIME');
        record.leaseExpiresAtMs = null; mark(record, 'retired'); return;
      }
      const policy = { enabled: false, mode: current.effectivePolicy.mode, exportable: current.effectivePolicy.exportable, codex: false };
      const result = snapshot(await control.configure({ ...record.scope, expectedBootEpoch: record.bootEpoch, expectedGeneration: generation, expectedSessionPolicyRevision: current.sessionPolicyRevision, opId: nextId(), policy }));
      if (owned(record, result) || result.sessionPolicyRevision !== current.sessionPolicyRevision + 1 || JSON.stringify(result.effectivePolicy) !== JSON.stringify(policy)) fail('INVALID_RUNTIME');
      record.leaseExpiresAtMs = result.leaseExpiresAtMs;
      mark(record, 'retired');
    } catch (error) { mark(record, 'retired', reason(error)); }
  }
  async function reconcile() {
    lastTickAt = clock(); lastError = null;
    let desired;
    try { desired = scopes(await listScopes()); }
    catch (error) { lastError = error?.name === 'ObusHostLifecycleError' ? reason(error) : 'SCOPES_UNAVAILABLE'; return; }
    if (stopping()) return;
    for (const [key, record] of records) {
      if (stopping()) return;
      if (!desired.has(key) && record.state !== 'retired') await disable(record);
    }
    for (const [key, scope] of desired) {
      if (stopping()) return;
      let record = records.get(key);
      if (!record) {
        // Retain bounded tombstones so removed or lost scopes cannot be reclaimed.
        if (records.size >= MAX_SCOPES) { lastError = 'SCOPE_LIMIT'; continue; }
        record = { scope, attempted: false, bootEpoch: null, leaseExpiresAtMs: null, state: 'pending', reason: null };
        records.set(key, record);
      }
      await reconcileRecord(record);
    }
  }
  function run() {
    if (activeWork) return activeWork;
    activeWork = reconcile().catch(error => { lastError = reason(error); }).finally(() => {
      activeWork = null;
      if (state === 'starting') state = 'running';
      schedule();
    }).then(status);
    return activeWork;
  }
  function start() {
    if (stopping()) return Promise.reject(Object.assign(new Error('Obus host lifecycle is closed.'), { code: 'HOST_LIFECYCLE_CLOSED' }));
    if (startWork) return startWork;
    try { generation = nextId(); } catch (error) { return Promise.reject(error); }
    state = 'starting';
    startWork = run();
    return startWork;
  }
  function tick() {
    if (state === 'idle') return Promise.reject(Object.assign(new Error('Obus host lifecycle has not started.'), { code: 'HOST_LIFECYCLE_NOT_STARTED' }));
    if (stopping()) return closeWork ?? Promise.resolve(status());
    clearTimer();
    return run();
  }
  function close() {
    if (closeWork) return closeWork;
    state = 'closing'; clearTimer();
    const pending = activeWork;
    closeWork = (async () => {
      if (pending) await pending;
      for (const record of records.values()) await disable(record);
      state = 'closed';
      return status();
    })();
    return closeWork;
  }
  return Object.freeze({ start, tick, close, status });
}
