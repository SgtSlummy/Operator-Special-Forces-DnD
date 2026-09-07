import { createHash, createHmac, randomBytes } from 'node:crypto';

const CONTRACT = 'raph-obus-game-runtime-v1';
const LIMIT = 8192;
const DEADLINE_MS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const ROOT = '/api/game/runtime';

function failure(code, status, message) {
  return Object.assign(new Error(message), { name: 'ObusHostControlError', code, status });
}
function invalid() { throw failure('INVALID_HOST_CONTROL_INPUT', 400, 'Invalid Obus host-control configuration or request.'); }
function invalidResponse() { throw failure('INVALID_OBUS_RUNTIME_RESPONSE', 502, 'Obus returned an invalid runtime response.'); }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, required, optional = []) {
  if (!plain(value)) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || required.some(key => !Object.hasOwn(value, key))) invalid();
}
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function scope(input) {
  if (typeof input.campaign !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.campaign) || typeof input.session !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.session)) invalid();
}
function cas(input) {
  if (!uuid(input.expectedBootEpoch) || !uuid(input.opId)) invalid();
}
function policy(value, response = false) {
  if (!response) exact(value, ['enabled', 'mode', 'exportable', 'codex']);
  const reject = response ? invalidResponse : invalid;
  if (!plain(value) || typeof value.enabled !== 'boolean' || !['local', 'local-free'].includes(value.mode) || typeof value.exportable !== 'boolean' || value.codex !== false) reject();
  const result = { enabled: value.enabled, mode: value.mode, exportable: value.exportable, codex: false };
  if (response) {
    if (value.tools !== false || value.personalMemory !== false || value.autoMemory !== false) reject();
    Object.assign(result, { tools: false, personalMemory: false, autoMemory: false });
  }
  return Object.freeze(result);
}
function snapshot(value, read) {
  if (!plain(value) || value.contract !== CONTRACT || !uuid(value.bootEpoch) || !(value.generation === null || uuid(value.generation)) || !integer(value.sessionPolicyRevision) || !(value.leaseExpiresAtMs === null || integer(value.leaseExpiresAtMs))) invalidResponse();
  const result = { contract: CONTRACT, bootEpoch: value.bootEpoch, generation: value.generation, sessionPolicyRevision: value.sessionPolicyRevision, leaseExpiresAtMs: value.leaseExpiresAtMs, effectivePolicy: policy(value.effectivePolicy, true) };
  if (read || Object.hasOwn(value, 'requiredForRoute')) {
    if (value.requiredForRoute !== true) invalidResponse();
    result.requiredForRoute = true;
  }
  for (const key of ['queuedCount', 'dispatchedCount']) {
    if (read || Object.hasOwn(value, key)) {
      if (!integer(value[key])) invalidResponse();
      result[key] = value[key];
    }
  }
  return Object.freeze(result);
}
// Protocol field names and IDs are ASCII; JSON.stringify retains Unicode string values.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function denied(status) {
  if (status === 401 || status === 403) return failure('OBUS_HOST_CONTROL_DENIED', status, 'Obus denied the host-control request.');
  if (status === 409 || status === 412) return failure('OBUS_HOST_CONTROL_CONFLICT', status, 'Obus runtime changed; obtain a fresh snapshot before deciding the next operation.');
  if (status === 429) return failure('OBUS_HOST_CONTROL_LIMITED', status, 'Obus host control is temporarily rate limited.');
  return failure('OBUS_HOST_CONTROL_UNAVAILABLE', Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502, 'Obus host control is unavailable.');
}

/** Private, explicit-dependency client. It never reads global settings, retries, or fills CAS fields. */
export function createObusHostControl(options) {
  exact(options, ['url', 'serviceToken', 'hostControlToken'], ['fetchImpl', 'now', 'nonce']);
  const { url, serviceToken, hostControlToken, fetchImpl = globalThis.fetch, now = Date.now, nonce = () => randomBytes(32).toString('hex') } = options;
  if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?\/?$/.test(url) || typeof serviceToken !== 'string' || !/^[0-9a-fA-F]{64}$/.test(serviceToken) || typeof hostControlToken !== 'string' || !HEX.test(hostControlToken) || typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof nonce !== 'function') invalid();
  let base;
  try { base = new URL(url).origin; } catch { invalid(); }
  const key = Buffer.from(hostControlToken, 'hex');

  async function request(method, path, input) {
    let body;
    const headers = { Accept: 'application/json', 'X-Obus-Game-Token': serviceToken };
    if (input) {
      body = canonical({ ...input, contract: CONTRACT });
      if (Buffer.byteLength(body, 'utf8') > LIMIT) invalid();
      let timestamp, requestNonce;
      try {
        const time = now();
        if (!integer(time)) invalid();
        timestamp = String(Math.floor(time / 1000));
        requestNonce = nonce();
        if (typeof requestNonce !== 'string' || !HEX.test(requestNonce)) invalid();
      } catch { invalid(); }
      const digest = createHash('sha256').update(body, 'utf8').digest('hex');
      const signed = [method, path, timestamp, requestNonce, digest].join('\n');
      Object.assign(headers, {
        'Content-Type': 'application/json',
        'X-Obus-Game-Host-Timestamp': timestamp,
        'X-Obus-Game-Host-Nonce': requestNonce,
        'X-Obus-Game-Host-Signature': createHmac('sha256', key).update(signed, 'utf8').digest('hex'),
      });
    }
    const controller = new AbortController();
    let timer, reader;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(failure('OBUS_HOST_CONTROL_TIMEOUT', 504, 'Obus host control timed out.'));
        controller.abort();
      }, DEADLINE_MS);
    });
    const target = `${base}${path}`;
    const work = (async () => {
      const response = await fetchImpl(target, { method, headers, ...(body === undefined ? {} : { body }), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      if (response.redirected || (response.url && response.url !== target)) invalidResponse();
      if (!response.ok) throw denied(response.status);
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') invalidResponse();
      const size = response.headers.get('content-length');
      if (size !== null && (!/^\d+$/.test(size) || Number(size) > LIMIT)) invalidResponse();
      reader = response.body?.getReader();
      if (!reader) invalidResponse();
      let length = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) invalidResponse();
        length += value.byteLength;
        if (length > LIMIT) invalidResponse();
        chunks.push(value);
      }
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { invalidResponse(); }
      if (path === `${ROOT}/session/revoke`) {
        if (!data || data.status !== 'session_revoked' || Object.keys(data).length !== 2 || !Object.hasOwn(data, 'runtime')) invalidResponse();
        const result = snapshot(data.runtime);
        if (result.generation !== null || result.leaseExpiresAtMs !== null || result.bootEpoch !== input.expectedBootEpoch || result.sessionPolicyRevision !== input.expectedSessionPolicyRevision + 1) invalidResponse();
        return result;
      }
      return snapshot(data, method === 'GET');
    })();
    try { return await Promise.race([work, timeout]); }
    catch (error) {
      if (error?.name === 'ObusHostControlError') throw error;
      throw failure('OBUS_HOST_CONTROL_UNAVAILABLE', 503, 'Obus host control is unavailable.');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
    }
  }

  return Object.freeze({
    async getRuntime(input) {
      exact(input, ['campaign', 'session']); scope(input);
      return request('GET', `${ROOT}?${new URLSearchParams({ campaign: input.campaign, session: input.session })}`);
    },
    async register(input) {
      exact(input, ['campaign', 'session', 'generation', 'expectedBootEpoch', 'expectedGeneration', 'opId', 'leaseSeconds']); scope(input); cas(input);
      if (!uuid(input.generation) || !(input.expectedGeneration === null || uuid(input.expectedGeneration)) || input.leaseSeconds !== 30) invalid();
      return request('PUT', `${ROOT}/host-generation`, input);
    },
    async renew(input) {
      exact(input, ['campaign', 'session', 'generation', 'expectedBootEpoch', 'expectedSessionPolicyRevision', 'opId', 'leaseSeconds']); scope(input); cas(input);
      if (!uuid(input.generation) || !integer(input.expectedSessionPolicyRevision) || input.leaseSeconds !== 30) invalid();
      return request('POST', `${ROOT}/host-generation/renew`, input);
    },
    async revoke(input) {
      exact(input, ['campaign', 'session', 'generation', 'expectedBootEpoch', 'expectedSessionPolicyRevision', 'opId']); scope(input); cas(input);
      if (input.session === 'campaign' || !uuid(input.generation) || !integer(input.expectedSessionPolicyRevision)) invalid();
      return request('POST', `${ROOT}/session/revoke`, input);
    },
    async configure(input) {
      exact(input, ['campaign', 'session', 'expectedBootEpoch', 'expectedGeneration', 'expectedSessionPolicyRevision', 'opId', 'policy']); scope(input); cas(input);
      if (!uuid(input.expectedGeneration) || !integer(input.expectedSessionPolicyRevision)) invalid();
      return request('PATCH', ROOT, { ...input, policy: policy(input.policy) });
    },
  });
}
