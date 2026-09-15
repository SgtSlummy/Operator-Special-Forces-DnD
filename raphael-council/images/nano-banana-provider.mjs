import { createCanvas, loadImage } from '@napi-rs/canvas';
import { validatePng } from './provider.mjs';

const MAX_BODY = 28 * 1024 * 1024;
const LOCAL = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/[^\s]*)?$/;
const ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
const SUBJECT_TYPES = new Set(['scene', 'character', 'item', 'location']);

function fail(message, code = 'NANO_BANANA_PROVIDER_ERROR') { throw Object.assign(new Error(message), { code }); }

function apiRoot(baseUrl) { return baseUrl.replace(/\/api\/v1\/?$/, ''); }

async function readBytes(response) {
  if (!response.ok || !response.body) fail('The Nano Banana service returned no image.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) fail('The Nano Banana service returned an oversized image.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function json(response) {
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) fail('The Nano Banana service returned an invalid response.');
  try { return await response.json(); } catch { fail('The Nano Banana service returned invalid JSON.'); }
}

function dataUriBytes(value) {
  const match = /^data:image\/(?:png|webp|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(value ?? ''));
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

async function asPng(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return validatePng(bytes);
  try {
    const image = await loadImage(bytes);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return validatePng(canvas.toBuffer('image/png'));
  } catch { fail('The Nano Banana service returned an unreadable image.'); }
}

function imageUrl(baseUrl, value) {
  try {
    const url = new URL(value, `${apiRoot(baseUrl)}/`);
    if (!LOCAL.test(url.toString())) fail('The Nano Banana image URL must stay on the local image service.', 'NANO_BANANA_REMOTE_URL');
    return url.toString();
  } catch { fail('The Nano Banana service returned an invalid image URL.'); }
}

/**
 * Adapter for the AI-DnD Nano Banana FastAPI contract. The service is local-only;
 * provider credentials remain in that service. Returned WebP/JPEG data is
 * normalized to PNG so the existing SceneImageService contract stays unchanged.
 */
export function createNanoBananaProvider({ baseUrl = 'http://127.0.0.1:8000/api/v1', fetchImpl = fetch, timeoutMs = 240000 } = {}) {
  if (typeof baseUrl !== 'string' || !LOCAL.test(baseUrl) || typeof fetchImpl !== 'function') fail('Invalid local Nano Banana configuration.', 'INVALID_NANO_BANANA_CONFIG');
  const base = baseUrl.replace(/\/$/, ''), cache = new Map();
  const request = async (url, options = {}) => fetchImpl(url, { ...options, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(timeoutMs) });
  const health = async () => {
      try {
        const result = await json(await request(`${apiRoot(base)}/health`, { method: 'GET', headers: { Accept: 'application/json' } }));
        return result.status === 'ok';
      } catch { return false; }
    };
  const generate = async ({ prompt, references = [], subjectType = 'scene', subjectName = 'Current scene', aspectRatio = '16:9', cacheKey = null } = {}) => {
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) fail('Invalid Nano Banana prompt.', 'INVALID_NANO_BANANA_REQUEST');
      if (!SUBJECT_TYPES.has(subjectType) || typeof subjectName !== 'string' || !subjectName.trim() || !ASPECT_RATIOS.has(aspectRatio)) fail('Invalid Nano Banana image request.', 'INVALID_NANO_BANANA_REQUEST');
      if (!Array.isArray(references) || references.length > 4) fail('Invalid Nano Banana references.', 'INVALID_NANO_BANANA_REQUEST');
      // The referenced API accepts prompts, not raw reference uploads. Approved
      // local references therefore remain owned by ComfyUI/Obus; do not silently
      // pretend this adapter used them.
      if (references.length) fail('Nano Banana does not accept reference uploads; use the local ComfyUI or Obus provider.', 'NANO_BANANA_REFERENCE_UNSUPPORTED');
      if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
      const response = await json(await request(`${base}/images/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ subject_type: subjectType, subject_name: subjectName.trim(), prompt: prompt.trim(), aspect_ratio: aspectRatio }),
      }));
      let bytes = dataUriBytes(response.image_data) ?? dataUriBytes(response.image_base64);
      if (!bytes && typeof response.image_url === 'string') bytes = await readBytes(await request(imageUrl(base, response.image_url), { method: 'GET', headers: { Accept: 'image/png,image/webp,image/jpeg' } }));
      if (!bytes) fail('The Nano Banana service returned no image.');
      const result = await asPng(bytes);
      if (cacheKey) cache.set(cacheKey, result);
      return result;
    };
  // SceneImageService uses the callable provider contract; the properties keep
  // health and direct generation available to startup checks and tests.
  generate.health = health;
  generate.generate = generate;
  return generate;
}

export { ASPECT_RATIOS, SUBJECT_TYPES };
