import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneImageHttp } from './http.mjs';

const ORIGIN = 'https://game.example';
const TOKENS = { alice: 'private-player-alice-123456789', bob: 'private-player-bob-123456789' };
const REQUEST_ID = '450325df-c107-4224-b2ee-b040c3c59624';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function serviceError(status, message = 'SECRET provider path /private/campaign') { return Object.assign(new Error(message), { status }); }

function fixture(status = 'ready') {
  const calls = [];
  const service = {
    authenticateAccess(token) {
      const owner = Object.keys(TOKENS).find(owner => TOKENS[owner] === token);
      return owner ? { campaign: 'campaign-one', owner } : null;
    },
    scene(scope) {
      calls.push(['scene', scope]);
      return { id: 'shared-room', revision: 3, title: 'The room', description: 'A table and a lamp.', subjects: [{ id: 'lamp', label: 'The lamp', secret: 'hidden seal' }], sourceEventId: 'event-3', gmNotes: 'SECRET' };
    },
    async requestImage(scope, options) {
      calls.push(['requestImage', scope, options]);
      return { id: 'image-one', status: 'queued', title: 'The room', focusLabel: 'The lamp', sceneRevision: 3, sourceEventId: 'event-3', stale: false, prompt: 'SECRET', file: '/private/image.png' };
    },
    getJob(scope, id) {
      calls.push(['getJob', scope, id]);
      if (scope.owner !== 'alice' || id !== 'image-one') throw serviceError(404);
      return { id, status, title: 'The room', focusLabel: 'The whole view', sceneRevision: 2, sourceEventId: 'event-2', stale: true, privatePrompt: 'SECRET' };
    },
    async image(scope, id) {
      calls.push(['image', scope, id]);
      return { bytes: PNG, mimeType: 'image/png', fileName: '../../private/SECRET.png' };
    },
  };
  return { service, calls, http: createSceneImageHttp(() => service) };
}

function request(path = '', { method = 'GET', owner = 'alice', body, origin = ORIGIN, headers = {} } = {}) {
  return new Request(`${ORIGIN}/api/scene-images${path}`, {
    method,
    headers: {
      ...(owner ? { cookie: `witnesslight_access=${encodeURIComponent(TOKENS[owner])}` } : {}),
      ...(origin !== null ? { origin } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

test('access code becomes a private cookie and never appears in the JSON response', async () => {
  const { http } = fixture();
  const response = await http.connect(request('/access', { owner: null, method: 'POST', body: { token: TOKENS.alice } }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\/api\/scene-images/);
  assert.deepEqual(await response.json(), { connected: true });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('disconnect expires the same scoped cookie', async () => {
  const { http } = fixture();
  const response = await http.disconnect(request('/access', { method: 'DELETE' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.match(response.headers.get('set-cookie'), /Path=\/api\/scene-images/);
});

test('every browser mutation rejects missing or foreign Origin before action', async () => {
  const { http, calls } = fixture();
  for (const origin of [null, 'https://evil.example', 'null']) {
    for (const [handler, path, method, body] of [
      ['connect', '/access', 'POST', { token: TOKENS.alice }],
      ['disconnect', '/access', 'DELETE', undefined],
      ['requestImage', '', 'POST', { requestId: REQUEST_ID, focusId: 'scene' }],
    ]) {
      const response = await http[handler](request(path, { method, body, origin }));
      assert.equal(response.status, 403);
    }
  }
  assert.equal(calls.length, 0);
});

test('cross-site browser metadata is rejected even if Origin is forged', async () => {
  const { http } = fixture();
  assert.equal((await http.requestImage(request('', { method: 'POST', body: { requestId: REQUEST_ID, focusId: 'scene' }, headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
});

test('all protected endpoints reject missing, malformed, duplicate or invalid cookies', async () => {
  const { http, calls } = fixture();
  for (const cookie of ['', 'witnesslight_access=%zz', 'witnesslight_access=wrong', `witnesslight_access=${TOKENS.alice}; witnesslight_access=${TOKENS.bob}`]) {
    for (const action of ['scene', 'job', 'image', 'requestImage']) {
      const options = { owner: null, headers: { cookie }, ...(action === 'requestImage' ? { method: 'POST', body: { requestId: REQUEST_ID, focusId: 'scene' } } : {}) };
      const response = await http[action](request('', options), 'image-one');
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  }
  assert.equal(calls.length, 0);
});

test('scene response uses authenticated owner and strips private fields', async () => {
  const { http, calls } = fixture();
  const response = await http.scene(request('?campaign=other&owner=bob&scene=secret'));
  const text = await response.text();
  assert.equal(response.status, 200); assert.doesNotMatch(text, /SECRET|gmNotes|hidden seal/);
  assert.deepEqual(calls[0], ['scene', { campaign: 'campaign-one', owner: 'alice' }]);
});

test('request carries only authenticated scope and UUID idempotency key to the service', async () => {
  const { http, calls } = fixture();
  const response = await http.requestImage(request('', { method: 'POST', body: { requestId: REQUEST_ID, focusId: 'lamp' } }));
  assert.equal(response.status, 202);
  assert.deepEqual(calls[0], ['requestImage', { campaign: 'campaign-one', owner: 'alice' }, { requestId: REQUEST_ID, focusId: 'lamp' }]);
  assert.doesNotMatch(await response.text(), /SECRET|private|prompt|file/);
});

test('request rejects forged scope, malformed IDs, unsupported fields and malformed JSON', async () => {
  const { http, calls } = fixture();
  for (const body of [
    { requestId: REQUEST_ID, focusId: 'scene', owner: 'bob' },
    { requestId: REQUEST_ID, focusId: 'scene', scene: 'gm-room' },
    { requestId: REQUEST_ID, focusId: '../secrets' },
    { requestId: 'invalid', focusId: 'scene' },
    { requestId: REQUEST_ID, focusId: { id: 'scene' } },
    [], null, '{',
  ]) assert.equal((await http.requestImage(request('', { method: 'POST', body }))).status, 400);
  assert.equal(calls.length, 0);
});

test('large bodies and non-JSON content are rejected', async () => {
  const { http } = fixture();
  assert.equal((await http.requestImage(request('', { method: 'POST', body: 'x'.repeat(4097) }))).status, 413);
  assert.equal((await http.requestImage(request('', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }))).status, 415);
});

test('cross-owner status and image requests receive a generic 404 and no image bytes', async () => {
  const { http, calls } = fixture();
  for (const action of ['job', 'image']) {
    const response = await http[action](request('/image-one', { owner: 'bob' }), 'image-one');
    assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /SECRET|private/);
  }
  assert.equal(calls.some(call => call[0] === 'image'), false);
});

test('unfinished and failed images cannot be downloaded', async () => {
  for (const status of ['queued', 'running', 'failed']) {
    const { http, calls } = fixture(status);
    assert.equal((await http.image(request('/image-one/image'), 'image-one')).status, 409);
    assert.equal(calls.some(call => call[0] === 'image'), false);
  }
});

test('ready image is delivered as authenticated PNG without server file names', async () => {
  const { http } = fixture();
  const response = await http.image(request('/image-one/image'), 'image-one');
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('content-disposition'), 'inline; filename="witnesslight-image-one.png"');
});

test('status retains stale snapshot metadata while excluding private service fields', async () => {
  const { http } = fixture();
  const response = await http.job(request('/image-one'), 'image-one');
  const data = await response.json();
  assert.equal(data.job.stale, true); assert.equal(data.job.sceneRevision, 2);
  assert.equal(data.job.privatePrompt, undefined);
});

test('unknown failures and invalid image IDs never expose server details', async () => {
  const { http, service } = fixture();
  for (const action of ['job', 'image']) assert.equal((await http[action](request(), '../../private')).status, 404);
  service.scene = () => { throw new Error('SECRET provider path /private/campaign'); };
  const response = await http.scene(request());
  assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /SECRET|private|provider/);
});
