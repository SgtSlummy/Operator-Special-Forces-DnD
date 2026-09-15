import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createNanoBananaProvider } from './nano-banana-provider.mjs';

const png = createCanvas(2, 2).toBuffer('image/png');
const dataUri = `data:image/png;base64,${png.toString('base64')}`;

function response(value, status = 200, contentType = 'application/json') {
  return new Response(contentType === 'application/json' ? JSON.stringify(value) : value, { status, headers: { 'content-type': contentType } });
}

test('Nano Banana adapter sends the documented payload and normalizes image data to PNG', async () => {
  const calls = [];
  const provider = createNanoBananaProvider({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/images/generate')) return response({ image_data: dataUri });
    return response({ status: 'ok' });
  } });
  assert.equal(await provider.health(), true);
  const bytes = await provider({ subjectType: 'location', subjectName: 'Saltglass Shore', prompt: 'A visible rocky shore.', aspectRatio: '16:9', cacheKey: 'shore:r1' });
  assert.deepEqual(bytes, png);
  assert.equal(provider.generate, provider);
  const payload = JSON.parse(calls.find(call => call.url.endsWith('/images/generate')).options.body);
  assert.deepEqual(payload, { subject_type: 'location', subject_name: 'Saltglass Shore', prompt: 'A visible rocky shore.', aspect_ratio: '16:9' });
});

test('Nano Banana adapter accepts only local service URLs and refuses unsupported references', async () => {
  assert.throws(() => createNanoBananaProvider({ baseUrl: 'https://example.com/api/v1' }), { code: 'INVALID_NANO_BANANA_CONFIG' });
  const provider = createNanoBananaProvider({ fetchImpl: async () => response({ image_data: dataUri }) });
  await assert.rejects(provider.generate({ prompt: 'scene', references: ['approved.png'] }), { code: 'NANO_BANANA_REFERENCE_UNSUPPORTED' });
});

test('Nano Banana adapter returns false when the local health endpoint is unavailable', async () => {
  const provider = createNanoBananaProvider({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await provider.health(), false);
});
