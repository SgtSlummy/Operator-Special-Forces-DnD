import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageProvider, validatePng } from './provider.mjs';

const png = createCanvas(2, 2).toBuffer('image/png');
const transport = { url: 'http://127.0.0.1:38175', headers: () => ({ 'X-Obus-Game-Token': 'fixture' }), capabilities: async () => ({ image_routes: true }) };
const result = () => Response.json({ routeId: 'obus-fixture', trace: [{ destination: 'local' }], image_base64: png.toString('base64') });

test('image requests go exclusively to Obus without provider selection or credentials', async () => {
  const generate = createImageProvider({ transport, fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:38175/api/game/images');
    assert.equal(init.headers.Authorization, undefined);
    const body = JSON.parse(init.body);
    assert.equal(body.prompt, 'Harbor');
    assert.equal(body.model, undefined);
    assert.equal(body.policy.mode, 'local');
    assert.equal(body.policy.codex, false);
    return result();
  } });
  assert.deepEqual(await generate({ prompt: 'Harbor' }), png);
});

test('image references send validated bytes to Obus without host paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obus-image-'));
  const path = join(dir, 'private-reference.png');
  writeFileSync(path, png);
  try {
    const generate = createImageProvider({ transport, fetchImpl: async (_url, init) => {
      assert.equal(init.body.includes(dir), false);
      const body = JSON.parse(init.body);
      assert.deepEqual(Buffer.from(body.references[0].data, 'base64'), png);
      return result();
    } });
    assert.deepEqual(await generate({ prompt: 'Harbor', references: [path] }), png);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unavailable Obus image routing never falls back to a direct provider', async () => {
  let calls = 0;
  const generate = createImageProvider({ transport: { ...transport, capabilities: async () => ({ image_routes: false }) }, fetchImpl: async () => { calls++; return result(); } });
  await assert.rejects(generate({ prompt: 'Harbor' }), { code: 'PROVIDER_UNAVAILABLE' });
  assert.equal(calls, 0);
  const failed = createImageProvider({ transport, fetchImpl: async () => { calls++; return new Response('', { status: 429 }); } });
  await assert.rejects(failed({ prompt: 'Harbor' }), /Obus image generation failed/);
  assert.equal(calls, 1);
});

test('unproven or nonlocal image provenance and truncated PNGs are rejected', async () => {
  const generate = createImageProvider({ transport, fetchImpl: async () => Response.json({ routeId: 'bad', trace: [{ destination: 'free' }], image_base64: png.toString('base64') }) });
  await assert.rejects(generate({ prompt: 'Harbor' }), /Invalid Obus image result/);
  await assert.rejects(validatePng(png.subarray(0, 10)), /Invalid image result/);
});
