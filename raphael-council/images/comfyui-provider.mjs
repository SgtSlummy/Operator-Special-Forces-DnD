import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validatePng } from './provider.mjs';

const MAX_BODY = 28 * 1024 * 1024;
const LOCAL = /^(?:https?:\/\/)(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?\/?$/;

function fail(message, code = 'LOCAL_IMAGE_PROVIDER_ERROR') {
  throw Object.assign(new Error(message), { code });
}

function replace(value, prompt, seed, reference) {
  if (typeof value === 'string') return value.replaceAll('__RAPHAEL_PROMPT__', prompt).replaceAll('__RAPHAEL_SEED__', String(seed)).replaceAll('__RAPHAEL_REFERENCE__', reference ?? '');
  if (Array.isArray(value)) return value.map(item => replace(item, prompt, seed, reference));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item, prompt, seed, reference)]));
  return value;
}

async function json(response) {
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('The local image renderer returned an invalid response.');
  try { return await response.json(); } catch { fail('The local image renderer returned invalid JSON.'); }
}

async function bytes(response) {
  if (!response.ok || !response.body) fail('The local image renderer returned no image.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) fail('The local image renderer returned an oversized image.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function upload(base, file, fetchImpl) {
  const form = new FormData();
  form.append('image', new Blob([await readFile(file)], { type: 'image/png' }), `reference-${randomUUID()}.png`);
  form.append('overwrite', 'true');
  const result = await json(await fetchImpl(`${base}/upload/image`, { method: 'POST', body: form, redirect: 'error' }));
  if (typeof result.name !== 'string' || typeof result.subfolder !== 'string' || typeof result.type !== 'string') fail('The local image renderer returned an invalid reference upload.');
  return result.name;
}

/**
 * Runs an API-format ComfyUI workflow on the local machine. The workflow may
 * contain __RAPHAEL_PROMPT__, __RAPHAEL_SEED__, and __RAPHAEL_REFERENCE__
 * placeholders. It never contacts a cloud provider.
 */
export function createComfyUiProvider({ baseUrl, workflow, fetchImpl = fetch, now = Date.now, pollMs = 250, timeoutMs = 240000 } = {}) {
  if (typeof baseUrl !== 'string' || !LOCAL.test(baseUrl) || !workflow || typeof workflow !== 'object' || typeof fetchImpl !== 'function' || typeof now !== 'function') fail('Invalid local image renderer configuration.', 'INVALID_LOCAL_IMAGE_CONFIG');
  const base = baseUrl.replace(/\/$/, '');
  return async function generate({ prompt, references = [] }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000 || !Array.isArray(references) || references.length > 4) fail('Invalid local image request.', 'INVALID_LOCAL_IMAGE_REQUEST');
    const seed = Math.floor(now() % 2_147_483_647);
    const reference = references.length ? await upload(base, references[0], fetchImpl) : undefined;
    const payload = await json(await fetchImpl(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: replace(workflow, prompt, seed, reference), client_id: randomUUID() }), redirect: 'error' }));
    if (typeof payload.prompt_id !== 'string' || !payload.prompt_id) fail('The local image renderer did not accept the workflow.');
    const end = now() + timeoutMs;
    while (now() < end) {
      const history = await json(await fetchImpl(`${base}/history/${encodeURIComponent(payload.prompt_id)}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error' }));
      const record = history[payload.prompt_id];
      if (record?.status?.status_str === 'error' || record?.status?.status_str === 'failed') fail('The local image workflow failed.');
      const images = Object.values(record?.outputs ?? {}).flatMap(output => Array.isArray(output.images) ? output.images : []);
      if (images.length) {
        const image = images[0];
        if (typeof image.filename !== 'string' || typeof image.subfolder !== 'string' || typeof image.type !== 'string') fail('The local image renderer returned an invalid output.');
        return validatePng(await bytes(await fetchImpl(`${base}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`, { method: 'GET', headers: { Accept: 'image/png' }, redirect: 'error' })));
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, end - now()))));
    }
    fail('The local image renderer timed out.', 'LOCAL_IMAGE_PROVIDER_TIMEOUT');
  };
}

export { replace as replaceWorkflowPlaceholders };

