import test from 'node:test';
import assert from 'node:assert/strict';
import { createObusHostLifecycle } from './host-lifecycle.mjs';

const CONTRACT = 'raph-obus-game-runtime-v1';
const BOOT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const scope = { campaign: 'camp-1', session: 'campaign' };
const key = value => `${value.campaign}/${value.session}`;
const copy = value => structuredClone(value);
function conflict() { throw Object.assign(Error('private conflict detail'), { code: 'OBUS_HOST_CONTROL_CONFLICT' }); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(initialScopes = [scope]) {
  let time = 1000000, id = 0, timerId = 0, inFlight = 0, maxInFlight = 0, requestedScopes = initialScopes;
  const rows = new Map(), calls = [], pendingTimers = new Map(), hooks = {};
  const basePolicy = { enabled: true, mode: 'local-free', exportable: false, codex: false, tools: false, personalMemory: false, autoMemory: false };
  function row(value) {
    if (!rows.has(key(value))) rows.set(key(value), { bootEpoch: BOOT, generation: null, sessionPolicyRevision: 0, leaseExpiresAtMs: null, effectivePolicy: { ...basePolicy } });
    return rows.get(key(value));
  }
  const snapshot = (value, read = false) => ({ contract: CONTRACT, ...copy(value), ...(read ? { requiredForRoute: true, queuedCount: 0, dispatchedCount: 0 } : {}) });
  async function invoke(name, input, effect) {
    calls.push({ name, input: copy(input) }); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try { if (hooks[name]) await hooks[name](input); return effect(); } finally { inFlight--; }
  }
  const control = {
    getRuntime(input) { return invoke('getRuntime', input, () => snapshot(row(input), true)); },
    register(input) { return invoke('register', input, () => {
      const saved = row(input);
      if (saved.bootEpoch !== input.expectedBootEpoch || saved.generation !== input.expectedGeneration || saved.generation === input.generation || input.leaseSeconds !== 30) conflict();
      const master = row({ campaign: input.campaign, session: 'campaign' });
      if (input.session !== 'campaign' && (master.generation !== input.generation || master.leaseExpiresAtMs <= time)) conflict();
      saved.generation = input.generation;
      saved.sessionPolicyRevision = input.session === 'campaign' ? saved.sessionPolicyRevision + 1 : Math.max(saved.sessionPolicyRevision + 1, master.sessionPolicyRevision);
      saved.leaseExpiresAtMs = time + input.leaseSeconds * 1000;
      saved.effectivePolicy = input.session === 'campaign' ? { ...basePolicy, codex: false } : copy(master.effectivePolicy);
      if (input.session === 'campaign') for (const [id, child] of rows) if (id.startsWith(`${input.campaign}/`) && id !== key(input)) {
        child.generation = null; child.leaseExpiresAtMs = null; child.sessionPolicyRevision++; child.effectivePolicy = copy(saved.effectivePolicy);
      }
      return snapshot(saved);
    }); },
    renew(input) { return invoke('renew', input, () => {
      const saved = row(input);
      if (saved.bootEpoch !== input.expectedBootEpoch || saved.generation !== input.generation || saved.sessionPolicyRevision !== input.expectedSessionPolicyRevision || saved.leaseExpiresAtMs <= time || input.leaseSeconds !== 30) conflict();
      const master = row({ campaign: input.campaign, session: 'campaign' });
      if (input.session !== 'campaign' && (master.generation !== input.generation || master.leaseExpiresAtMs <= time)) conflict();
      saved.leaseExpiresAtMs = time + input.leaseSeconds * 1000;
      return snapshot(saved);
    }); },
    revoke(input) { return invoke('revoke', input, () => {
      const saved = row(input);
      if (input.session === 'campaign' || saved.bootEpoch !== input.expectedBootEpoch || saved.generation !== input.generation || saved.sessionPolicyRevision !== input.expectedSessionPolicyRevision || saved.leaseExpiresAtMs <= time) conflict();
      saved.generation = null; saved.leaseExpiresAtMs = null; saved.sessionPolicyRevision++;
      return snapshot(saved);
    }); },
    configure(input) { return invoke('configure', input, () => {
      if (input.session !== 'campaign') conflict();
      const saved = row(input);
      if (saved.bootEpoch !== input.expectedBootEpoch || saved.generation !== input.expectedGeneration || saved.sessionPolicyRevision !== input.expectedSessionPolicyRevision || saved.leaseExpiresAtMs <= time || input.policy.codex !== false) conflict();
      assert.deepEqual(Object.keys(input.policy).sort(), ['codex', 'enabled', 'exportable', 'mode']);
      saved.effectivePolicy = { ...saved.effectivePolicy, ...input.policy }; saved.sessionPolicyRevision++;
      for (const [id, child] of rows) if (id.startsWith(`${input.campaign}/`) && id !== key(input)) {
        child.effectivePolicy = copy(saved.effectivePolicy); child.sessionPolicyRevision++;
      }
      return snapshot(saved);
    }); },
  };
  const timers = {
    setTimeout(callback, delay) { const token = ++timerId; pendingTimers.set(token, { callback, delay }); return token; },
    clearTimeout(token) { pendingTimers.delete(token); },
  };
  const options = { control, listScopes: () => requestedScopes, now: () => time, uuid: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}`, timers };
  return { control, rows, row, calls, hooks, timers, pendingTimers, options,
    advance(ms) { time += ms; }, setScopes(values) { requestedScopes = values; }, get maxInFlight() { return maxInFlight; },
    fireTimer() { const [token, value] = pendingTimers.entries().next().value; pendingTimers.delete(token); value.callback(); },
    create(overrides = {}) { return createObusHostLifecycle({ ...options, ...overrides }); },
  };
}

test('construction is inert, explicit start coalesces and shares one generation across deduped scopes', async () => {
  const second = { campaign: 'camp-2', session: 'campaign' };
  const f = fixture([scope, { ...scope }, second]);
  const lifecycle = f.create();
  assert.equal(lifecycle.status().state, 'idle'); assert.equal(f.calls.length, 0); assert.equal(f.pendingTimers.size, 0);
  await assert.rejects(lifecycle.tick(), { code: 'HOST_LIFECYCLE_NOT_STARTED' });
  const first = lifecycle.start(); assert.equal(lifecycle.start(), first); await first;
  const registrations = f.calls.filter(call => call.name === 'register');
  assert.equal(registrations.length, 2);
  for (const call of registrations) {
    assert.equal(call.input.generation, lifecycle.status().generation);
    assert.equal(call.input.expectedBootEpoch, BOOT); assert.equal(call.input.expectedGeneration, null); assert.equal(call.input.leaseSeconds, 30);
    assert.notEqual(call.input.opId, call.input.generation);
  }
  assert.notEqual(registrations[0].input.opId, registrations[1].input.opId);
  assert.equal(lifecycle.status().scopes.length, 2);
  assert.equal(f.pendingTimers.size, 1); assert.equal([...f.pendingTimers.values()][0].delay, 10000);
  assert.equal(Object.isFrozen(lifecycle.status().scopes), true);
  await lifecycle.close();
});

test('a new actual host replaces the generation while the Obus boot is unchanged and starts with Codex off', async () => {
  const f = fixture(); const first = f.create(); await first.start();
  const previousGeneration = first.status().generation;
  await first.close();
  const next = f.create(); await next.start();
  assert.notEqual(next.status().generation, previousGeneration);
  const registration = f.calls.filter(call => call.name === 'register').at(-1).input;
  assert.equal(registration.expectedGeneration, previousGeneration);
  assert.equal(registration.expectedBootEpoch, BOOT);
  assert.equal(f.row(scope).effectivePolicy.codex, false);
  assert.equal(f.row(scope).bootEpoch, BOOT);
  await next.close();
});

test('renewal fetches the current policy revision and preserves an all-AI-off policy', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
  f.row(scope).effectivePolicy.enabled = false; f.row(scope).effectivePolicy.exportable = true; f.row(scope).sessionPolicyRevision += 2;
  const revision = f.row(scope).sessionPolicyRevision; f.advance(10000);
  await lifecycle.tick();
  const renew = f.calls.filter(call => call.name === 'renew').at(-1).input;
  assert.equal(renew.expectedSessionPolicyRevision, revision);
  assert.equal(renew.generation, lifecycle.status().generation);
  assert.equal(f.row(scope).effectivePolicy.enabled, false);
  assert.equal(f.row(scope).effectivePolicy.exportable, true);
  assert.equal(lifecycle.status().scopes[0].state, 'active');
  await lifecycle.close();
});

test('policy CAS conflict waits for another tick and obtains the newer revision', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
  let once = true;
  f.hooks.renew = async () => { if (once) { once = false; f.row(scope).sessionPolicyRevision++; f.row(scope).effectivePolicy.enabled = false; } };
  f.advance(10000); await lifecycle.tick();
  assert.equal(f.calls.filter(call => call.name === 'renew').length, 1);
  assert.equal(lifecycle.status().scopes[0].reason, 'CONTROL_CONFLICT');
  const revised = f.row(scope).sessionPolicyRevision;
  f.advance(10000); await lifecycle.tick();
  assert.equal(f.calls.filter(call => call.name === 'renew').length, 2);
  assert.equal(f.calls.filter(call => call.name === 'renew').at(-1).input.expectedSessionPolicyRevision, revised);
  assert.equal(f.row(scope).effectivePolicy.enabled, false);
  await lifecycle.close();
});

test('expired leases are never re-registered or revived by later ticks or close', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
  f.advance(30000); const before = f.calls.length;
  await lifecycle.tick(); await lifecycle.tick(); await lifecycle.close();
  assert.equal(f.calls.length, before);
  assert.equal(lifecycle.status().scopes[0].state, 'lost');
  assert.equal(lifecycle.status().scopes[0].reason, 'LEASE_EXPIRED');
});

test('boot or generation replacement prevents renewal, reclaim and shutdown policy changes', async () => {
  for (const field of ['bootEpoch', 'generation']) {
    const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
    f.row(scope)[field] = OTHER; f.advance(10000);
    await lifecycle.tick(); await lifecycle.tick(); await lifecycle.close();
    assert.equal(f.calls.filter(call => call.name === 'register').length, 1);
    assert.equal(f.calls.filter(call => call.name === 'renew' || call.name === 'configure').length, 0);
    assert.equal(f.row(scope).effectivePolicy.enabled, true);
    assert.equal(lifecycle.status().scopes[0].reason, 'AUTHORITY_REPLACED');
  }
});

test('timer and concurrent manual ticks serialize and coalesce without overlapping authority calls', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
  const entered = deferred(), release = deferred();
  f.hooks.renew = async () => { entered.resolve(); await release.promise; };
  f.advance(10000); f.fireTimer(); await entered.promise;
  const first = lifecycle.tick(), second = lifecycle.tick(); assert.equal(first, second);
  assert.equal(f.pendingTimers.size, 0);
  release.resolve(); await first;
  assert.equal(f.calls.filter(call => call.name === 'renew').length, 1);
  assert.equal(f.maxInFlight, 1); assert.equal(f.pendingTimers.size, 1);
  await lifecycle.close(); assert.equal(f.pendingTimers.size, 0);
});

test('close during a GET stops registration and closes idempotently without scheduling a timer', async () => {
  const f = fixture(); const entered = deferred(), release = deferred();
  f.hooks.getRuntime = async () => { entered.resolve(); await release.promise; };
  const lifecycle = f.create(); const start = lifecycle.start(); await entered.promise;
  const close = lifecycle.close(); assert.equal(lifecycle.close(), close);
  release.resolve(); await Promise.all([start, close]);
  assert.equal(f.calls.filter(call => call.name !== 'getRuntime').length, 0);
  assert.equal(f.pendingTimers.size, 0); assert.equal(lifecycle.status().state, 'closed');
  await assert.rejects(lifecycle.start(), { code: 'HOST_LIFECYCLE_CLOSED' });
});

test('close drains a dispatched registration then disables its own new authority', async () => {
  const f = fixture(); const entered = deferred(), release = deferred();
  f.hooks.register = async () => { entered.resolve(); await release.promise; };
  const lifecycle = f.create(); const start = lifecycle.start(); await entered.promise;
  const close = lifecycle.close(); assert.equal(lifecycle.status().state, 'closing');
  release.resolve(); await Promise.all([start, close]);
  assert.deepEqual(f.calls.map(call => call.name), ['getRuntime', 'register', 'getRuntime', 'configure']);
  assert.equal(f.row(scope).effectivePolicy.enabled, false);
  assert.equal(lifecycle.status().state, 'closed'); assert.equal(f.pendingTimers.size, 0);
});

test('shutdown uses fresh policy CAS, preserves mode/exportability and never disables a replacement racing its GET', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
  f.row(scope).effectivePolicy.mode = 'local'; f.row(scope).effectivePolicy.exportable = true; f.row(scope).sessionPolicyRevision++;
  const revision = f.row(scope).sessionPolicyRevision;
  await lifecycle.close();
  const configure = f.calls.filter(call => call.name === 'configure')[0].input;
  assert.equal(configure.expectedSessionPolicyRevision, revision);
  assert.deepEqual(configure.policy, { enabled: false, mode: 'local', exportable: true, codex: false });
  const other = fixture(); const stale = other.create(); await stale.start();
  other.hooks.configure = async () => { other.row(scope).generation = OTHER; };
  await stale.close();
  assert.equal(other.row(scope).effectivePolicy.enabled, true);
  assert.equal(stale.status().scopes[0].reason, 'CONTROL_CONFLICT');
  assert.equal(other.calls.filter(call => call.name === 'configure').length, 1);
});

test('removed scopes are disabled and fenced while newly discovered scopes use the same host generation', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.start();
  const added = { campaign: 'camp-2', session: 'campaign' };
  f.setScopes([added]); await lifecycle.tick();
  assert.equal(f.row(scope).effectivePolicy.enabled, false);
  assert.equal(f.row(added).generation, lifecycle.status().generation);
  assert.equal(lifecycle.status().scopes.find(item => item.campaign === scope.campaign).state, 'retired');
  f.setScopes([scope, added]); await lifecycle.tick();
  assert.equal(f.calls.filter(call => call.name === 'register' && call.input.campaign === scope.campaign).length, 1);
  assert.equal(f.row(scope).effectivePolicy.enabled, false);
  await lifecycle.close();
});

test('uncertain registration adopts only its own still-live result without another registration', async () => {
  const f = fixture(); const actual = f.control.register;
  f.control.register = async input => { await actual(input); throw Error('response was lost'); };
  const lifecycle = f.create(); await lifecycle.start();
  assert.equal(lifecycle.status().scopes[0].state, 'unavailable');
  await lifecycle.tick();
  assert.equal(lifecycle.status().scopes[0].state, 'active');
  assert.equal(f.calls.filter(call => call.name === 'register').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'renew').length, 1);
  await lifecycle.close();
  const failed = fixture(); failed.hooks.register = async () => { throw Error('never dispatched'); };
  const lost = failed.create(); await lost.start(); await lost.tick(); await lost.tick();
  assert.equal(failed.calls.filter(call => call.name === 'register').length, 1);
  assert.equal(lost.status().scopes[0].state, 'lost'); await lost.close();
});

test('invalid or unavailable scope reads do not admit partial scopes or renew stale lists', async () => {
  const invalidLists = [null, [...Array(101)].map(() => scope), [scope, { campaign: '../private', session: 'a' }], [{ ...scope, role: 'host' }]];
  for (const invalid of invalidLists) {
    const f = fixture(invalid); const lifecycle = f.create(); await lifecycle.start();
    assert.equal(f.calls.length, 0); assert.equal(lifecycle.status().lastError, 'INVALID_SCOPES'); await lifecycle.close();
  }
  const f = fixture(); let unavailable = false;
  const lifecycle = f.create({ listScopes: () => { if (unavailable) throw Error('private database detail'); return [scope]; } });
  await lifecycle.start(); unavailable = true; const before = f.calls.length; await lifecycle.tick();
  assert.equal(f.calls.length, before); assert.equal(lifecycle.status().lastError, 'SCOPES_UNAVAILABLE'); await lifecycle.close();
});

test('initial GET outages may recover but errors and invalid runtime responses remain sanitized', async () => {
  const f = fixture(); let outage = true;
  f.hooks.getRuntime = async () => { if (outage) throw Error('private credential secret'); };
  const lifecycle = f.create(); await lifecycle.start();
  assert.equal(lifecycle.status().scopes[0].reason, 'CONTROL_UNAVAILABLE');
  assert.equal(JSON.stringify(lifecycle.status()).includes('secret'), false);
  outage = false; await lifecycle.tick(); assert.equal(lifecycle.status().scopes[0].state, 'active');
  await lifecycle.close();
  const malformed = fixture(); const actual = malformed.control.register;
  malformed.control.register = async input => ({ ...await actual(input), generation: OTHER });
  const rejected = malformed.create(); await rejected.start(); await rejected.tick(); await rejected.close();
  assert.equal(rejected.status().scopes[0].reason, 'INVALID_RUNTIME');
  assert.equal(malformed.calls.filter(call => call.name === 'renew' || call.name === 'configure').length, 0);
});

test('retained scope fences are bounded to100 and never silently evicted for re-registration', async () => {
  const initial = Array.from({ length: 100 }, (_, index) => ({ campaign: `camp-${index}`, session: 'campaign' }));
  const f = fixture(initial); const lifecycle = f.create(); await lifecycle.start();
  f.setScopes([{ campaign: 'camp-new', session: 'campaign' }]); await lifecycle.tick();
  assert.equal(lifecycle.status().scopes.length, 100);
  assert.equal(lifecycle.status().lastError, 'SCOPE_LIMIT');
  assert.equal(f.calls.filter(call => call.name === 'register').length, 100);
  await lifecycle.close();
});

test('close before start is inert and malformed dependencies or UUIDs fail without authority calls', async () => {
  const f = fixture(); const lifecycle = f.create(); await lifecycle.close();
  assert.equal(f.calls.length, 0); assert.equal(lifecycle.status().generation, null);
  await assert.rejects(lifecycle.start(), { code: 'HOST_LIFECYCLE_CLOSED' });
  assert.throws(() => createObusHostLifecycle(), { code: 'INVALID_CONFIGURATION' });
  assert.throws(() => f.create({ timers: {} }), { code: 'INVALID_CONFIGURATION' });
  const bad = f.create({ uuid: () => 'not-a-uuid' }); await assert.rejects(bad.start(), { code: 'INVALID_UUID' });
  assert.equal(f.calls.length, 0); await bad.close();
});

test('masters register before unordered children, whose leases inherit a disabled master', async () => {
  const child = { ...scope, session: 'recording-one' };
  const f = fixture([child, scope]);
  const actual = f.control.register;
  f.control.register = async input => {
    const result = await actual(input);
    if (input.session === 'campaign') {
      f.row(scope).effectivePolicy.enabled = false; result.effectivePolicy.enabled = false;
    }
    return result;
  };
  const lifecycle = f.create(); await lifecycle.start();
  assert.deepEqual(f.calls.filter(c => c.name === 'register').map(c => c.input.session), ['campaign', 'recording-one']);
  assert.equal(f.row(child).effectivePolicy.enabled, false);
  assert.equal(f.row(child).generation, f.row(scope).generation);
  await lifecycle.close();
  assert.equal(f.calls.filter(c => c.name === 'configure').every(c => c.input.session === 'campaign'), true);
  assert.equal(f.calls.filter(c => c.name === 'revoke').length, 1);
  assert.equal(f.row(child).generation, null);
});

test('temporary master startup outage leaves a child unattempted until master authority is established', async () => {
  const child = { ...scope, session: 'recording-one' };
  const f = fixture([scope, child]); let offline = true;
  f.hooks.getRuntime = async input => { if (input.session === 'campaign' && offline) throw Error('offline'); };
  const lifecycle = f.create(); await lifecycle.start();
  assert.equal(f.calls.filter(c => c.name === 'register').length, 0);
  assert.equal(lifecycle.status().scopes.find(s => s.session === child.session).reason, 'MASTER_UNAVAILABLE');
  offline = false; await lifecycle.tick();
  assert.equal(f.row(child).generation, lifecycle.status().generation);
  assert.equal(f.calls.filter(c => c.name === 'register' && c.input.session === child.session).length, 1);
  await lifecycle.close();
});

test('removing a child revokes only that session immediately and cannot revive it on a later list', async () => {
  const first = { ...scope, session: 'recording-one' }, second = { ...scope, session: 'recording-two' };
  const f = fixture([scope, first, second]); const lifecycle = f.create(); await lifecycle.start();
  const masterRevision = f.row(scope).sessionPolicyRevision;
  f.setScopes([scope, second]); await lifecycle.tick();
  assert.equal(f.row(first).generation, null); assert.equal(f.row(first).leaseExpiresAtMs, null);
  assert.equal(f.row(scope).sessionPolicyRevision, masterRevision); assert.equal(f.row(scope).effectivePolicy.enabled, true);
  assert.equal(f.row(second).generation, lifecycle.status().generation);
  assert.equal(f.calls.filter(c => c.name === 'configure').length, 0);
  assert.equal(f.calls.filter(c => c.name === 'revoke').length, 1);
  f.setScopes([scope, first, second]); await lifecycle.tick();
  assert.equal(f.calls.filter(c => c.name === 'register' && c.input.session === first.session).length, 1);
  await lifecycle.close();
});

test('master replacement fences every child without old-host renewal or revocation of the replacement', async () => {
  const child = { ...scope, session: 'recording-one' };
  const f = fixture([scope, child]); const lifecycle = f.create(); await lifecycle.start();
  f.row(scope).generation = OTHER; f.row(child).generation = null; f.row(child).leaseExpiresAtMs = null;
  const before = f.calls.length; await lifecycle.tick(); await lifecycle.close();
  assert.deepEqual(f.calls.slice(before).map(c => c.name), ['getRuntime']);
  assert.equal(lifecycle.status().scopes.find(s => s.session === child.session).state, 'lost');
});

test('a child list without its campaign master cannot dispatch any host operation', async () => {
  const f = fixture([{ ...scope, session: 'recording-one' }]); const lifecycle = f.create();
  await lifecycle.start(); assert.equal(lifecycle.status().lastError, 'INVALID_SCOPES'); assert.equal(f.calls.length, 0);
  await lifecycle.close();
});
