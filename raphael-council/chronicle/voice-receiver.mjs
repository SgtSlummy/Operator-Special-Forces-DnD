import { randomUUID } from 'node:crypto';
import { EndBehaviorType } from '@discordjs/voice';
import { ChronicleError } from './store.mjs';

export const MAX_VOICE_STREAMS = 8;
export const MAX_VOICE_PENDING = 24;
export const MAX_VOICE_PCM_BYTES = 192000 * 20;

export function wav(pcm) {
  const head = Buffer.alloc(44); head.write('RIFF'); head.writeUInt32LE(pcm.length + 36, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(48000, 24);
  head.writeUInt32LE(192000, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

async function defaultDecoder() {
  const { default: prism } = await import('prism-media');
  return new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
}

// No Discord connection, decoder, timer, credential or audio work occurs here.
// openConnection owns the connection and returns a capture lease; this receiver
// owns only its subscriptions, bounded PCM buffers and transcription drain.
export function createVoiceReceiver({ client, config, store, service, openConnection, createDecoder = defaultDecoder,
  authorizeParticipant = service.provider?.authorizeParticipant?.bind(service.provider),
  captureRuntime = service.provider?.captureRuntime?.bind(service.provider) }) {
  if (typeof openConnection !== 'function') throw new TypeError('A voice ownership strategy is required.');
  let lease = null, controller = null, sessionId = null, generation = 0, drainingGeneration = null;
  let runtimeTimer = null, latestRuntime = null, unsubscribe = null;
  const streams = new Map(), pending = new Set(), gapKeys = new Set();
  const allowed = member => member && !member.user?.bot && ((config.playerIds ?? []).includes(member.id) || (config.dmIds ?? []).includes(member.id) ||
    (config.playerRoleId && member.roles?.cache?.has(config.playerRoleId)) || (config.dmRoleId && member.roles?.cache?.has(config.dmRoleId)) ||
    member.permissions?.has(8n) || member.permissions?.has(32n));
  const hostAllowed = member => member && !member.user?.bot && ((config.dmIds ?? []).includes(member.id) ||
    (config.dmRoleId && member.roles?.cache?.has(config.dmRoleId)) || member.permissions?.has(8n) || member.permissions?.has(32n));
  const validRuntime = runtime => runtime?.contract === 'raph-obus-game-runtime-v1' && typeof runtime.bootEpoch === 'string' && !!runtime.bootEpoch &&
    typeof runtime.generation === 'string' && !!runtime.generation && Number.isSafeInteger(runtime.sessionPolicyRevision) && runtime.sessionPolicyRevision >= 0 &&
    Number.isSafeInteger(runtime.leaseExpiresAtMs) && runtime.leaseExpiresAtMs > Date.now();
  const snapshotRuntime = runtime => Object.freeze({ contract: runtime.contract, bootEpoch: runtime.bootEpoch, generation: runtime.generation,
    sessionPolicyRevision: runtime.sessionPolicyRevision, leaseExpiresAtMs: runtime.leaseExpiresAtMs });
  const gap = (id, key, text) => { if (!gapKeys.has(key)) { gapKeys.add(key); service.gap(id, text); } };
  function track(task) { pending.add(task); task.finally(() => pending.delete(task)).catch(() => {}); return task; }
  function revoke(user, flush = false) {
    const active = streams.get(user);
    if (active) {
      if (flush) active.flush?.();
      active.drop = true; streams.delete(user); clearTimeout(active.timer);
      active.opus?.destroy(); active.decoder?.destroy();
      for (const part of active.parts) part.fill(0);
      active.parts = []; active.length = 0;
    }
    lease?.revoke?.(user);
  }
  async function stop({ flush = false } = {}) {
    const draining = generation;
    drainingGeneration = flush ? draining : null;
    generation++;
    clearInterval(runtimeTimer); runtimeTimer = null; latestRuntime = null;
    const failures = [];
    for (const user of [...streams.keys()]) { try { revoke(user, flush); } catch (error) { failures.push(error); } }
    try { unsubscribe?.(); unsubscribe = null; } catch (error) { failures.push(error); }
    controller?.abort(); controller = null; sessionId = null;
    const previous = lease;
    if (previous) {
      try { await previous.release(); if (lease === previous) lease = null; } catch (error) { failures.push(error); }
    }
    await Promise.allSettled([...pending]);
    if (drainingGeneration === draining) drainingGeneration = null;
    if (failures.length) throw new AggregateError(failures, 'Voice capture did not detach cleanly.');
  }
  async function start(id, host, { authorize = () => true } = {}) {
    const permitted = async () => { try { return await authorize() === true; } catch { return false; } };
    const session = store.get(id);
    if (session.status !== 'active') throw new ChronicleError('Resume the session before joining voice.');
    if (!session.campaign || typeof authorizeParticipant !== 'function' || typeof captureRuntime !== 'function') throw new ChronicleError('Current campaign membership and Obus host authority are required for voice.');
    const stopping = stop(), attempt = generation;
    await stopping;
    if (attempt !== generation) throw new ChronicleError('Voice connection was cancelled.');
    const abort = new AbortController(); controller = abort;
    const current = () => generation === attempt && !abort.signal.aborted && store.get(id).status === 'active';
    const guild = await client.guilds.fetch(config.guildId), member = await guild.members.fetch({ user: host, force: true });
    const channel = member.voice?.channel;
    if (!channel || channel.type !== 2) throw new ChronicleError('Join a normal Discord voice channel in this campaign server first.');
    if (!hostAllowed(member) || !await permitted() || !current()) throw new ChronicleError('Voice connection was cancelled or GM access changed.');
    const hostScope = Object.freeze({ campaign: session.campaign, owner: host, role: 'host' });
    const captured = await captureRuntime(hostScope, id);
    if (!validRuntime(captured) || !await permitted() || !current()) throw new ChronicleError('Current Obus host authority is unavailable or voice was cancelled.');
    const initialRuntime = snapshotRuntime(captured);
    latestRuntime = initialRuntime; sessionId = id; gapKeys.clear();
    const authority = async () => {
      if (!current() || !await permitted()) return false;
      const gm = await guild.members.fetch({ user: host, force: true });
      return current() && hostAllowed(gm) && (gm.voice?.channelId ?? gm.voice?.channel?.id) === channel.id && await permitted() === true;
    };
    let activeLease;
    try {
      activeLease = await openConnection({ guild, channel, authorize: authority, signal: abort.signal,
        onInvalidate: () => {
          if (generation === attempt) {
            gap(id, 'connection', 'Voice disconnected or changed; speech during the gap was not captured. Reconnect with /session voice.');
            void stop().catch(() => {});
          }
        } });
      if (!activeLease || typeof activeLease.subscribe !== 'function' || typeof activeLease.onSpeaking !== 'function' || typeof activeLease.release !== 'function') {
        throw new ChronicleError('The shared voice receiver is unavailable.');
      }
      if (!current() || !await authority() || activeLease.active !== true) {
        throw new ChronicleError('Voice connection was cancelled or GM access changed.');
      }
      lease = activeLease;
    } catch (error) {
      let cleanupError;
      if (typeof activeLease?.release === 'function') {
        try { await activeLease.release(); }
        catch (failure) { lease = activeLease; cleanupError = failure; }
      }
      if (generation === attempt) { controller = null; sessionId = null; latestRuntime = null; abort.abort(); }
      if (cleanupError) throw new AggregateError([error, cleanupError], 'Voice capture did not detach cleanly.');
      throw error;
    }
    let refreshing = false;
    const refreshRuntime = () => {
      if (refreshing || lease !== activeLease || !current()) return;
      refreshing = true;
      const task = Promise.resolve().then(() => captureRuntime(hostScope, id)).then(runtime => {
        if (lease !== activeLease || !current()) return;
        if (!validRuntime(runtime) || runtime.bootEpoch !== initialRuntime.bootEpoch || runtime.generation !== initialRuntime.generation) {
          gap(id, 'runtime-changed', 'Obus host authority changed; reconnect voice after the host is ready.');
          void stop().catch(() => {}); return;
        }
        latestRuntime = snapshotRuntime(runtime);
      }).catch(() => {
        if (lease === activeLease && current()) {
          latestRuntime = null; gap(id, 'runtime-unavailable', 'Obus host authority could not be verified; speech capture is temporarily unavailable.');
        }
      }).finally(() => { refreshing = false; });
      track(task);
    };
    runtimeTimer = setInterval(refreshRuntime, 10000); runtimeTimer.unref?.();
    const speaking = user => {
      if (streams.has(user) || lease !== activeLease || !current() || !store.hasConsent(id, user)) return;
      if (streams.size >= MAX_VOICE_STREAMS || pending.size >= MAX_VOICE_PENDING) {
        gap(id, 'capacity', 'Speech queue full; this segment was not captured.'); return;
      }
      const captureEpoch = store.privacy(id, user).captureEpoch;
      if (!Number.isSafeInteger(captureEpoch) || captureEpoch < 0) return;
      const scope = Object.freeze({ campaign: session.campaign, owner: user, role: 'player' });
      const active = { opus: null, decoder: null, parts: [], length: 0, captureEpoch,
        context: null, at: null, scene: null, drop: false, timer: null, gapReported: false };
      streams.set(user, active);
      const capturedAllowed = async context => {
        const generationAllowed = () => generation === attempt || drainingGeneration === attempt;
        if (!generationAllowed() || store.get(id).campaign !== context.scope.campaign || !['active', 'ending'].includes(store.get(id).status) ||
            !store.hasConsent(id, user) || store.privacy(id, user).captureEpoch !== context.capturedConsentEpoch) return false;
        if (await authorizeParticipant(context.scope) !== true) return false;
        const fresh = await guild.members.fetch({ user, force: true });
        return allowed(fresh) && (fresh.voice?.channelId ?? fresh.voice?.channel?.id) === channel.id && generationAllowed() &&
          store.hasConsent(id, user) && store.privacy(id, user).captureEpoch === context.capturedConsentEpoch;
      };
      active.flush = () => {
        if (active.drop || !active.length) return;
        const pcm = Buffer.concat(active.parts), context = active.context, at = active.at, scene = active.scene;
        for (const part of active.parts) part.fill(0);
        active.parts = []; active.length = 0; active.context = null;
        if (pcm.length < 19200 || !context || !store.hasConsent(id, user) || !['active', 'ending'].includes(store.get(id).status)) { pcm.fill(0); return; }
        if (pending.size >= MAX_VOICE_PENDING) { pcm.fill(0); gap(id, 'capacity', 'Speech queue full; this segment was not captured.'); return; }
        track(capturedAllowed(context).then(async accepted => {
          if (!accepted) return;
          const bytes = wav(pcm);
          try { await service.speech(id, { user, speaker: active.speaker, bytes, at, scene, captureEpoch: context.capturedConsentEpoch,
            context, authorizeParticipant: () => capturedAllowed(context) }); }
          finally { bytes.fill(0); }
        }).catch(() => gap(id, `membership:${user}`, 'A voice segment was skipped because current campaign membership could not be verified.'))
          .finally(() => pcm.fill(0)));
      };
      const setup = async () => {
        const context = { scope, capturedConsentEpoch: captureEpoch };
        if (!await capturedAllowed(context) || active.drop || !current()) return revoke(user);
        const fresh = await guild.members.fetch({ user, force: true });
        active.speaker = String(fresh.displayName ?? fresh.user?.username ?? user).slice(0, 100);
        active.decoder = await createDecoder();
        if (active.drop || !current()) { active.decoder.destroy(); return; }
        active.opus = await activeLease.subscribe(user, { authorize: () => capturedAllowed(context), options: { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } } });
        if (active.drop || !current() || !await capturedAllowed(context)) {
          active.opus?.destroy(); active.decoder?.destroy();
          if (streams.get(user) === active) revoke(user);
          return;
        }
        active.timer = setTimeout(() => {
          active.flush(); revoke(user); gap(id, `window:${user}`, 'A voice stream exceeded its receive window. Pause briefly to start a fresh stream.');
        }, 10 * 60000); active.timer.unref?.();
        active.decoder.on('data', buffer => {
          if (active.drop || !current() || !store.hasConsent(id, user) || store.privacy(id, user).captureEpoch !== captureEpoch) { buffer.fill(0); revoke(user); return; }
          if (!validRuntime(latestRuntime)) {
            buffer.fill(0); gap(id, 'runtime-unverified', 'Speech received before current Obus host authority was verified was discarded.'); refreshRuntime(); return;
          }
          if (!Buffer.isBuffer(buffer) || buffer.length > MAX_VOICE_PCM_BYTES) { buffer.fill?.(0); revoke(user); gap(id, 'oversized-frame', 'An oversized voice frame was discarded.'); return; }
          if (active.length + buffer.length > MAX_VOICE_PCM_BYTES) active.flush();
          if (!active.length) {
            active.context = Object.freeze({ scope, session: id, requestId: randomUUID(), capturedRuntime: snapshotRuntime(latestRuntime), capturedConsentEpoch: captureEpoch });
            active.at = Date.now(); active.scene = store.get(id).scene?.seq ?? null;
          }
          active.parts.push(buffer); active.length += buffer.length;
          if (active.length >= MAX_VOICE_PCM_BYTES) active.flush();
        });
        const finish = () => { if (streams.get(user) !== active) return; active.flush(); revoke(user); };
        active.decoder.on('end', finish);
        const failed = () => { if (streams.get(user) === active) { revoke(user); gap(id, `decode:${user}`, 'A voice segment could not be decoded; typed capture remains available.'); } };
        active.opus.on('error', failed); active.decoder.on('error', failed); active.opus.pipe(active.decoder);
      };
      track(setup().catch(() => {
        if (streams.get(user) === active) { revoke(user); gap(id, `membership:${user}`, 'Speech capture skipped a participant whose campaign membership could not be verified.'); }
      }));
    };
    try {
      unsubscribe = activeLease.onSpeaking(speaking);
      store.transaction(() => store.append(id, `voice:${Date.now()}`, 'session', { text: `Voice scribe connected to ${channel.name}. Only opted-in campaign members are transcribed. Each Discord account is its speaker label; shared microphones cannot identify individual people.` }));
    } catch (error) {
      try { await stop(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Voice capture did not detach cleanly.'); }
      throw error;
    }
  }
  return { start, stop, revoke, status: () => lease?.active ? 'connected (ready)' : 'disconnected' };
}
