import { readFile } from 'node:fs/promises';
import { loadImage } from '@napi-rs/canvas';
import { ObusTransport } from '../ai/obus.mjs';

export async function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > 20 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Invalid image result');
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width * height > 16_000_000) throw new Error('Invalid image dimensions');
  await loadImage(bytes);
  return bytes;
}

// The game submits a task; Obus owns model selection and provider credentials.
export function createImageProvider({ transport = new ObusTransport(), fetchImpl = fetch } = {}) {
  return async function generate({ prompt, references = [] }) {
    const capabilities = await transport.capabilities();
    if (capabilities.image_routes !== true) {
      throw Object.assign(new Error('Image generation is not available through Obus.'), { code: 'PROVIDER_UNAVAILABLE' });
    }
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000 || references.length > 4) {
      throw new Error('Invalid image request');
    }
    const images = [];
    let referenceBytes = 0;
    for (const reference of references) {
      const bytes = await validatePng(await readFile(reference));
      referenceBytes += bytes.length;
      if (referenceBytes > 6 * 1024 * 1024) throw new Error('Image references are too large');
      images.push({ mime_type: 'image/png', data: bytes.toString('base64') });
    }
    const response = await fetchImpl(`${transport.url}/api/game/images`, {
      method: 'POST', headers: transport.headers(),
      body: JSON.stringify({ contract: 'raph-obus-game-v1', prompt, references: images,
        policy: { mode: 'local', codex: false, tools: false, personal_memory: false, auto_memory: false } }),
      signal: AbortSignal.timeout(240000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Obus image generation failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Invalid image result');
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 28 * 1024 * 1024) throw new Error('Image result is too large');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result.routeId || !Array.isArray(result.trace) || result.trace.length === 0 ||
        result.trace.some(step => step.destination !== 'local') || result.tool_calls?.length ||
        typeof result.image_base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.image_base64)) {
      throw new Error('Invalid Obus image result');
    }
    return validatePng(Buffer.from(result.image_base64, 'base64'));
  };
}
