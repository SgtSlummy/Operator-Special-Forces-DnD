const MOODS = new Set(['exploration', 'tension', 'drama', 'battle', 'sanctuary', 'aftermath']);
const clamp = value => Math.max(0, Math.min(1, Number(value)));

/**
 * Pure adaptive-music coordinator. Davy owns the concrete player/voice
 * connection; this module only emits bounded playback intents through it.
 */
export function createAdaptiveMusic({ player, tracks, fadeMs = 1200, narrationDuck = 0.35 }) {
  if (!player || typeof player.play !== 'function' || typeof player.setVolume !== 'function' || typeof player.stop !== 'function') throw new TypeError('A Davy-owned music player adapter is required.');
  const catalog = new Map((tracks ?? []).filter(track => MOODS.has(track.id)).map(track => [track.id, track]));
  if (!catalog.size) throw new TypeError('At least one approved music track is required.');
  let mood = null, override = null, narration = false, silent = false;
  const volume = () => silent ? 0 : narration ? clamp(narrationDuck) : 1;
  const active = () => override ?? mood;
  const apply = async (next, reason) => {
    if (!next || !catalog.has(next) || silent) return false;
    await player.play(catalog.get(next), { fadeMs, reason });
    await player.setVolume(volume());
    return true;
  };
  return {
    async setMood(next) { if (!MOODS.has(next) || !catalog.has(next)) throw new RangeError('Unsupported music mood.'); mood = next; return apply(active(), 'mood'); },
    async setOverride(next) { if (next !== null && (!MOODS.has(next) || !catalog.has(next))) throw new RangeError('Unsupported music override.'); override = next; return next ? apply(next, 'dm-override') : apply(mood, 'override-cleared'); },
    async setNarration(activeNarration) { narration = Boolean(activeNarration); await player.setVolume(volume()); return narration; },
    async setSilence(value) { silent = Boolean(value); await player.setVolume(volume()); if (silent) await player.stop({ fadeMs, reason: 'break-silence' }); else if (active()) await apply(active(), 'silence-ended'); return silent; },
    state() { return Object.freeze({ mood, override, narration, silent, active: silent ? null : active(), volume: volume() }); },
  };
}
