import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveMusic } from './music.mjs';

const tracks = ['exploration', 'battle', 'aftermath'].map(id => ({ id, file: `${id}.mp3` }));
function fixture() {
  const calls = [];
  const player = {
    async play(track, options) { calls.push(['play', track.id, options]); },
    async setVolume(value) { calls.push(['volume', value]); },
    async stop(options) { calls.push(['stop', options]); },
  };
  return { calls, music: createAdaptiveMusic({ player, tracks, fadeMs: 500, narrationDuck: 0.25 }) };
}

test('mood changes play approved tracks and narration ducks volume', async () => {
  const f = fixture();
  await f.music.setMood('exploration');
  await f.music.setMood('battle');
  await f.music.setNarration(true);
  assert.deepEqual(f.calls.map(call => call[0]), ['play', 'volume', 'play', 'volume', 'volume']);
  assert.equal(f.calls.at(-1)[1], 0.25);
  assert.equal(f.music.state().active, 'battle');
});

test('DM override and break silence never destroy the injected player', async () => {
  const f = fixture();
  await f.music.setMood('exploration');
  await f.music.setOverride('battle');
  await f.music.setSilence(true);
  assert.equal(f.music.state().active, null);
  assert.equal(f.calls.at(-1)[0], 'stop');
  await f.music.setSilence(false);
  assert.equal(f.music.state().active, 'battle');
  assert.equal(f.calls.filter(call => call[0] === 'stop').length, 1);
});

test('unknown moods and missing player adapters fail closed', () => {
  assert.throws(() => createAdaptiveMusic({ player: {}, tracks }), /player adapter/);
  const f = fixture();
  assert.rejects(f.music.setMood('unknown'), /Unsupported music mood/);
});
