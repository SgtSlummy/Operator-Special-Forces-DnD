import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the actual component's handlers/effects with a small hook host. These are
// transport/lifecycle contracts; layout and native React rendering remain browser checks.
const source = readFileSync(new URL('../app/play/chronicle.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const require = createRequire(import.meta.url);
const response = (body, status = 200) => Response.json(body, { status });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snapshot = (overrides = {}) => ({
  role: 'host', owner: 'player-1',
  session: { id: 1, title: 'Harbor session', status: 'active', revision: 1 },
  entries: [], consent: { capture: false, external: false }, commands: [], next: 0,
  ...overrides,
});
const text = node => {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  return typeof node === 'object' ? text(node.props?.children) : String(node);
};
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object') return [];
  return [node, ...descendants(node.props?.children)];
}

function mount(onFetch) {
  const slots = [], effects = [], intervals = new Set(), calls = [];
  let cursor = 0, tree, stopped = false;
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { fn, deps };
      return slots[index].fn;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports, require: name => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: Symbol.for('fragment') };
      if (name === '../../client/api.mjs') return { apiFetch: (path, options = {}) => {
        const call = { path, options, body: options.body ? JSON.parse(options.body) : null };
        calls.push(call); return onFetch(call);
      } };
      return require(name);
    },
    AbortController, AbortSignal, crypto: { randomUUID }, Date,
    setInterval: fn => { intervals.add(fn); return fn; },
    clearInterval: fn => intervals.delete(fn),
  });
  const panel = {
    calls,
    render() {
      if (stopped) return;
      cursor = 0; tree = exports.default();
      for (const effect of effects.splice(0)) effect();
    },
    async settle() {
      for (let i = 0; i < 6; i += 1) {
        await new Promise(resolve => setImmediate(resolve)); panel.render();
      }
    },
    all(type) { return descendants(tree).filter(node => node.type === type); },
    find(type, predicate) {
      const nodes = panel.all(type).filter(node => predicate(node));
      assert.equal(nodes.length, 1, `Expected one ${type}, found ${nodes.length}`);
      return nodes[0];
    },
    button(label) { return panel.find('button', node => text(node) === label); },
    text() { return text(tree); },
    poll() { for (const callback of intervals) callback(); },
    unmount() {
      stopped = true;
      for (const slot of slots) slot?.cleanup?.();
      assert.equal(intervals.size, 0, 'polling stops on unmount');
    },
  };
  panel.render(); return panel;
}
function writeNote(panel, value) {
  panel.find('textarea', node => node.props.rows === 2).props.onChange({ target: { value } });
  panel.render();
  panel.find('form', node => text(node).includes('Add a session note')).props.onSubmit({ preventDefault() {} });
}

test('opening the shared panel only reads the shared API and never grants capture', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot())));
  await panel.settle();
  assert.equal(panel.calls.length, 1);
  assert.equal(panel.calls[0].path, '/api/game/chronicle?after=0');
  assert.equal(panel.calls[0].options.method, undefined);
  assert.deepEqual(panel.all('input').filter(node => node.props.type === 'checkbox').map(node => node.props.checked), [false, false]);
  assert.match(panel.text(), /Opening this page does not start recording/);
  panel.unmount();
});

test('an uncertain note retries the identical request ID and immutable payload', async () => {
  let attempts = 0;
  const panel = mount(call => {
    if (!call.body) return Promise.resolve(response(snapshot()));
    attempts += 1;
    return attempts === 1 ? Promise.reject(new Error('Connection lost after commit')) : Promise.resolve(response({}));
  });
  await panel.settle();
  writeNote(panel, 'Maren found the bell.');
  await panel.settle();
  panel.button('Retry saved request').props.onClick();
  await panel.settle();
  const posts = panel.calls.filter(call => call.body);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1].body, posts[0].body);
  assert.equal(posts[0].body.text, 'Maren found the bell.');
  assert.equal(posts[0].body.expectedRevision, 1);
  assert.equal(panel.find('textarea', node => node.props.rows === 2).props.value, '');
  panel.unmount();
});

test('capture withdrawal submits immediately while other work is pending and repairs a known stale revision', async () => {
  const note = deferred();
  let revision = 1, capture = true, consentAttempts = 0;
  const panel = mount(call => {
    if (!call.body) return Promise.resolve(response(snapshot({ session: { id: 1, title: 'Harbor session', status: 'active', revision }, consent: { capture, external: false } })));
    if (call.body.type === 'note') return note.promise;
    consentAttempts += 1;
    if (consentAttempts === 1) { revision = 2; return Promise.resolve(response({ error: 'stale' }, 409)); }
    revision = 3; capture = false;
    return Promise.resolve(response({}));
  });
  await panel.settle();
  writeNote(panel, 'Still sending.'); panel.render();
  panel.all('input').filter(node => node.props.type === 'checkbox')[0].props.onChange({ target: { checked: false } });
  assert.equal(panel.calls.filter(call => call.body).length, 2, 'withdrawal is dispatched before pending work resolves');
  await panel.settle();
  const consents = panel.calls.filter(call => call.body?.type === 'consent');
  assert.equal(consents.length, 2);
  assert.notEqual(consents[0].body.requestId, consents[1].body.requestId, 'known rejection can receive a fresh request ID');
  assert.equal(consents[1].body.expectedRevision, 2);
  assert.equal(consents[1].body.capture, false);
  assert.equal(consents[1].body.external, false);
  assert.match(panel.text(), /Your consent is saved/);
  assert.match(panel.text(), /Session note awaiting confirmation/);
  panel.unmount();
  assert.equal(panel.calls.find(call => call.body?.type === 'note').options.signal.aborted, true);
});

test('an uncertain external-consent request keeps its ID and does not enable capture', async () => {
  let external = false, attempts = 0;
  const panel = mount(call => {
    if (!call.body) return Promise.resolve(response(snapshot({ consent: { capture: false, external } })));
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error('lost'));
    external = true; return Promise.resolve(response({}));
  });
  await panel.settle();
  panel.all('input').filter(node => node.props.type === 'checkbox')[1].props.onChange({ target: { checked: true } });
  await panel.settle();
  panel.button('Retry saved consent request').props.onClick();
  await panel.settle();
  const posts = panel.calls.filter(call => call.body);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(posts[0].body.capture, false);
  assert.equal(posts[0].body.external, true);
  panel.unmount();
});

test('a late poll cannot replace a newer session after a mutation refresh', async () => {
  const stale = deferred();
  let reads = 0;
  const panel = mount(call => {
    if (call.body) return Promise.resolve(response({}));
    reads += 1;
    if (reads === 2) return stale.promise;
    return Promise.resolve(response(snapshot(reads >= 3 ? { session: { id: 2, title: 'New harbor session', status: 'active', revision: 1 } } : {})));
  });
  await panel.settle();
  panel.poll();
  panel.all('input').filter(node => node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  await panel.settle();
  assert.match(panel.text(), /New harbor session/);
  stale.resolve(response(snapshot({ session: { id: 1, title: 'Stale private session', status: 'active', revision: 99 } })));
  await panel.settle();
  assert.doesNotMatch(panel.text(), /Stale private session/);
  assert.match(panel.text(), /New harbor session/);
  panel.unmount();
});

test('revocation clears transcript and drafts, aborts pending work, and ignores its late reply', async () => {
  const pending = deferred();
  let reads = 0;
  const panel = mount(call => {
    if (call.body) return pending.promise;
    reads += 1;
    return Promise.resolve(reads > 1 ? response({ error: 'revoked' }, 403) : response(snapshot({ entries: [{ seq: 1, kind: 'transcript', text: 'Private campaign evidence.' }], next: 1 })));
  });
  await panel.settle();
  writeNote(panel, 'Private unsaved note.');
  panel.poll(); await panel.settle();
  assert.doesNotMatch(panel.text(), /Private campaign evidence|Private unsaved note/);
  assert.match(panel.text(), /Reconnect to your campaign/);
  assert.equal(panel.calls.find(call => call.body).options.signal.aborted, true);
  pending.resolve(response({})); await panel.settle();
  assert.equal(reads, 2, 'revoked mutation reply must not start another refresh');
  assert.doesNotMatch(panel.text(), /Request saved/);
  panel.unmount();
});

test('correction controls use the server permission and show evidence markers', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot({
    entries: [
      { seq: 1, kind: 'transcript', user: 'player-1', text: 'Protected original', canCorrect: false },
      { seq: 2, kind: 'transcript', text: 'Corrected words', speaker: 'Maren', canCorrect: true, corrected: true, at: '2026-09-06T12:00:00Z' },
      { seq: 3, kind: 'note', text: 'Never render deleted text', deleted: true, canCorrect: true },
      { seq: 4, kind: 'correction', text: 'Correction audit', target: 2 },
    ], next: 4,
  }))));
  await panel.settle();
  assert.equal(panel.all('button').filter(node => /^Correct E/.test(text(node))).length, 1);
  panel.button('Correct E2').props.onClick(); panel.render();
  assert.equal(panel.find('textarea', node => node.props.rows === 3).props.value, 'Corrected words');
  assert.match(panel.text(), /Corrected entry/);
  assert.match(panel.text(), /Correction to E 2|Correction to E2/);
  assert.doesNotMatch(panel.text(), /Never render deleted text/);
  panel.unmount();
});

test('a second session starts with the no-session API contract after the prior recap ends', async () => {
  let current = snapshot({ session: { id: 'ended-session', title: 'Completed mission', status: 'ended', revision: 50 }, next: 50 });
  const panel = mount(call => {
    if (!call.body) return Promise.resolve(response(current));
    assert.equal(call.body.type, 'start');
    assert.equal(call.body.sessionId, null, 'start cannot target the ended session returned by GET');
    assert.equal(call.body.expectedRevision, 0, 'start uses the empty-session revision');
    assert.equal(call.body.title, 'Second harbor mission');
    current = snapshot({ session: { id: 'second-session', title: call.body.title, status: 'active', revision: 51 }, next: 51 });
    return Promise.resolve(response({ command: { status: 'done' } }));
  });
  await panel.settle();
  const title = panel.find('input', node => node.props.maxLength === 100);
  title.props.onChange({ target: { value: 'Second harbor mission' } }); panel.render();
  panel.find('form', node => text(node).includes('Start session')).props.onSubmit({ preventDefault() {} });
  await panel.settle();
  assert.equal(panel.calls.filter(call => call.body).length, 1);
  assert.match(panel.text(), /Second harbor mission/);
  assert.doesNotMatch(panel.text(), /Completed mission/);
  assert.equal(panel.all('button').some(node => text(node) === 'Start session'), false);
  panel.unmount();
});

test('closing sessions cannot start another session or save new notes', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot({ session: { id: 1, title: 'Closing mission', status: 'ending', revision: 8 } }))));
  await panel.settle();
  assert.equal(panel.all('button').some(node => text(node) === 'Start session'), false);
  assert.equal(panel.all('button').some(node => text(node) === 'Save note'), false);
  assert.match(panel.text(), /recap must finish before another session starts/);
  assert.equal(panel.calls.filter(call => call.body).length, 0);
  panel.unmount();
});

test('paused sessions retain corrections but cannot submit notes, with API-aligned text limits', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot({
    session: { id: 1, title: 'Paused mission', status: 'paused', revision: 8 },
    entries: [{ seq: 7, kind: 'transcript', text: 'Correctable evidence.', canCorrect: true }], next: 8,
  }))));
  await panel.settle();
  assert.equal(panel.find('textarea', node => node.props.rows === 2).props.disabled, true);
  assert.equal(panel.button('Save note').props.disabled, true);
  assert.equal(panel.find('textarea', node => node.props.rows === 2).props.maxLength, 4000);
  writeNote(panel, 'Programmatic submission while paused.');
  await panel.settle();
  assert.equal(panel.calls.filter(call => call.body).length, 0, 'handler must also reject paused notes');
  panel.button('Correct E7').props.onClick(); panel.render();
  assert.equal(panel.find('textarea', node => node.props.rows === 3).props.maxLength, 4000);
  assert.equal(panel.button('Save correction').props.disabled, false);
  panel.unmount();
});

test('failed bot requests render the safe queue error message and omit internal fields', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot({
    commands: [{ requestId: 'failed', type: 'voice', status: 'failed', error: { code: 'FORBIDDEN', message: 'The GM no longer has access.', status: 403, internalCredential: 'NEVER_RENDER' } }],
  }))));
  await panel.settle();
  assert.match(panel.text(), /The GM no longer has access/);
  assert.doesNotMatch(panel.text(), /NEVER_RENDER|\[object Object\]/);
  panel.unmount();
});

for (const status of ['active', 'paused', 'ending', 'ended']) {
  test(`host delivery retry binds the ${status} session and keeps uncertain request receipts`, async () => {
    let attempts = 0;
    const panel = mount(call => {
      if (!call.body) return Promise.resolve(response(snapshot({
        session: { id: 'delivery-session', title: 'Delivery mission', status, revision: 42 }, next: 42,
        delivery: { pending: 5, failed: 2, retrying: 3, nextAttemptAt: 1788725100000 },
      })));
      assert.equal(call.body.type, 'retry-delivery');
      assert.equal(call.body.sessionId, 'delivery-session');
      assert.equal(call.body.expectedRevision, 42);
      assert.deepEqual(Object.keys(call.body).sort(), ['expectedRevision', 'requestId', 'sessionId', 'type']);
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('Lost response after persistence')) : Promise.resolve(response({ command: { status: 'queued' } }));
    });
    await panel.settle();
    assert.match(panel.text(), /Pending: 5 · Waiting to retry: 3 · Needs attention: 2/);
    assert.match(panel.text(), /Next automatic attempt:/);
    panel.button('Retry delivery').props.onClick(); await panel.settle();
    assert.equal(panel.button('Retry delivery').props.disabled, true);
    panel.button('Retry saved request').props.onClick(); await panel.settle();
    const posts = panel.calls.filter(call => call.body);
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[0].body, posts[1].body, 'uncertain delivery work must keep its request ID and session binding');
    assert.match(panel.text(), /Request saved for the bot/);
    panel.unmount();
  });
}

test('players see delivery status without the host retry control', async () => {
  let role = 'host';
  const panel = mount(() => Promise.resolve(response(snapshot({
    role, delivery: { pending: 2, failed: 2, retrying: 0, nextAttemptAt: null },
  }))));
  await panel.settle();
  const oldRetry = panel.button('Retry delivery');
  role = 'player'; panel.poll(); await panel.settle();
  assert.match(panel.text(), /Needs attention: 2/);
  assert.equal(panel.all('button').some(node => text(node) === 'Retry delivery'), false);
  oldRetry.props.onClick(); await panel.settle();
  assert.equal(panel.calls.filter(call => call.body).length, 0, 'an old host handler must use current role');
  assert.doesNotMatch(panel.text(), /Next automatic attempt:/);
  panel.unmount();
});

test('uncertain Discord delivery outcomes require review without offering another send', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot({
    delivery: { pending: 2, failed: 0, retrying: 0, uncertain: 2, nextAttemptAt: null },
  }))));
  await panel.settle();
  assert.match(panel.text(), /2 deliveries need review in Discord; retries for those deliveries are paused/);
  assert.equal(panel.all('button').some(node => text(node) === 'Retry delivery'), false);
  assert.doesNotMatch(panel.text(), /Next automatic attempt:/);
  assert.equal(panel.calls.filter(call => call.body).length, 0);
  panel.unmount();
});

test('delivery retries are hidden without failures and disabled while already queued', async () => {
  let failures = 0, commands = [];
  const panel = mount(() => Promise.resolve(response(snapshot({
    commands, delivery: { pending: 1, failed: failures, retrying: 1, nextAttemptAt: 1788725100000 },
  }))));
  await panel.settle();
  assert.equal(panel.all('button').some(node => text(node) === 'Retry delivery'), false);
  failures = 1; commands = [{ requestId: 'already-saved', type: 'retry-delivery', status: 'queued' }];
  panel.poll(); await panel.settle();
  assert.equal(panel.button('Retry delivery').props.disabled, true);
  assert.match(panel.text(), /Waiting for bot/);
  panel.unmount();
});

test('queued voice work is distinct from completed results and an idle session cannot grant consent', async () => {
  const panel = mount(() => Promise.resolve(response(snapshot({
    session: null,
    commands: [
      { requestId: 'queued', type: 'voice', status: 'queued' },
      { requestId: 'done', type: 'leave', status: 'done', result: { message: 'Bot left the voice channel.', internalCredential: 'NEVER_RENDER' } },
    ],
  }))));
  await panel.settle();
  assert.equal(panel.all('input').filter(node => node.props.type === 'checkbox').every(node => node.props.disabled), true);
  assert.match(panel.text(), /Waiting for bot/);
  assert.match(panel.text(), /Bot left the voice channel/);
  assert.doesNotMatch(panel.text(), /NEVER_RENDER/);
  panel.unmount();
});
