import test from 'node:test';
import assert from 'node:assert/strict';
import { createChronicleRuntimeCore } from '../discord/chronicle-core.mjs';
import { ChronicleStore } from './store.mjs';

test('Chronicle runtime exposes injected music without owning the player', async () => {
  const store = new ChronicleStore(':memory:');
  const music = { setMood: async () => true };
  const voice = { start: async () => {}, stop: async () => {} };
  const runtime = createChronicleRuntimeCore({
    client: {}, config: { guildId: 'guild', channelId: 'channel', campaignId: 'campaign', chronicleDir: '.', playerIds: [], dmIds: [] },
    images: {}, transport: {}, provider: { write: async () => 'fixture' },
    makeVoice: () => voice, store, music,
  });
  assert.equal(runtime.music, music);
  await runtime.close();
});
