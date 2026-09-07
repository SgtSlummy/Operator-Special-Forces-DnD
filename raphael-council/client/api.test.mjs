import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiPath } from './api.mjs';
import { sessionCookie } from '../auth/discord.mjs';

const discord = { hostname: '100000000000000003.discordsays.com' };
const browser = { hostname: 'game.example' };
const paths = ['/api/auth/config', '/api/auth/activity', '/api/auth/logout', '/api/game', '/api/game/updates?after=12', '/api/game/map?revision=12', '/api/game/characters', '/api/game/scene-images/job-1/image', '/api/game/ai', '/api/game/checks?before=8', '/api/game/council', '/api/game/counsel', '/api/game/departure', '/api/game/world', '/api/game/journal?after=3'];

test('browser and Activity API paths map to identical backend resources', () => {
  for (const path of paths) {
    assert.equal(apiPath(path, browser), path);
    assert.equal(apiPath(path, { hostname: 'localhost' }), path);
    const proxyPath = apiPath(path, discord);
    assert.equal(proxyPath, `/.proxy${path}`);
    // Discord consumes /.proxy and applies the configured / -> game-host map.
    const upstream = new URL(proxyPath.slice('/.proxy'.length), 'https://game.example');
    assert.equal(upstream.pathname + upstream.search, path);
  }
});

test('path selection does not trust query parameters or lookalike hosts', () => {
  for (const hostname of ['discordsays.com', '100.discordsays.com.evil.example', 'evil-discordsays.com', 'game.example']) {
    assert.equal(apiPath('/api/game', { hostname, search: '?frame_id=fake' }), '/api/game');
  }
  for (const path of ['https://external.example/api', '//external.example/api', '/api/../private', '/api/%2e%2e/private', '/private', '/api\\private']) {
    assert.throws(() => apiPath(path, discord), TypeError);
  }
});

test('shared fetch preserves command receipt IDs, revisions, cancellation and credentials', async t => {
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else delete globalThis.location;
  });
  const command = { type: 'move', requestId: 'same-receipt', expectedRevision: 12, path: [{ x: 2, y: 1 }] };
  const signal = new AbortController().signal;
  const observed = [];
  globalThis.fetch = async (path, options) => {
    observed.push(path);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal, signal);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), command);
    return Response.json({ receipt: { requestId: command.requestId, revision: 13 } });
  };
  for (const location of [browser, discord]) {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: location });
    const response = await apiFetch('/api/game', { method: 'POST', body: JSON.stringify(command), signal });
    assert.equal((await response.json()).receipt.requestId, command.requestId);
  }
  assert.deepEqual(observed, ['/api/game', '/.proxy/api/game']);
});

test('Activity cookie covers proxied API requests and logout expires the same cookie', () => {
  const config = { activityOrigin: `https://${discord.hostname}`, publicOrigin: 'https://game.example' };
  for (const token of ['fixture-session', '']) {
    const activity = sessionCookie(config, token, true);
    assert.match(activity, /; Path=\/;/);
    assert.match(activity, /; Secure; SameSite=None; Partitioned; Domain=100000000000000003\.discordsays\.com$/);
    assert.match(activity, token ? /Max-Age=43200/ : /Max-Age=0/);
    const web = sessionCookie(config, token);
    assert.match(web, /Path=\/api; HttpOnly/);
    assert.match(web, /SameSite=Lax; Secure/);
    assert.doesNotMatch(web, /Domain=|Partitioned/);
  }
});
