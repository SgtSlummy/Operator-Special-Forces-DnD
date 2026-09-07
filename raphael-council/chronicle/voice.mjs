import { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { ChronicleError } from './store.mjs';

export function wav(pcm) {
  const head = Buffer.alloc(44); head.write('RIFF'); head.writeUInt32LE(pcm.length + 36, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22); head.writeUInt32LE(48000, 24);
  head.writeUInt32LE(192000, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
// PCM is bounded in memory and discarded after transcription; no raw audio archive.
export function createVoiceCapture({ client, config, store, service, authorizeParticipant = service.provider?.authorizeParticipant?.bind(service.provider), captureRuntime = service.provider?.captureRuntime?.bind(service.provider) }) {
  let connection = null, sessionId = null, generation = 0, drainingGeneration = null, runtimeTimer = null, latestRuntime = null;
  const streams = new Map(), pending = new Set();
  const allowed = member => member && !member.user.bot && (config.playerIds.includes(member.id) || config.dmIds.includes(member.id) ||
    (config.playerRoleId && member.roles.cache.has(config.playerRoleId)) || (config.dmRoleId && member.roles.cache.has(config.dmRoleId)) || member.permissions.has(8n) || member.permissions.has(32n));
  const validRuntime = runtime => runtime?.contract === 'raph-obus-game-runtime-v1' && typeof runtime.bootEpoch === 'string' && typeof runtime.generation === 'string' &&
    Number.isSafeInteger(runtime.sessionPolicyRevision) && runtime.sessionPolicyRevision >= 0 && Number.isSafeInteger(runtime.leaseExpiresAtMs) && runtime.leaseExpiresAtMs > Date.now();
  const snapshotRuntime = runtime => Object.freeze({ contract: runtime.contract, bootEpoch: runtime.bootEpoch, generation: runtime.generation,
    sessionPolicyRevision: runtime.sessionPolicyRevision, leaseExpiresAtMs: runtime.leaseExpiresAtMs });
  function revoke(user, flush = false) {
    const active = streams.get(user); if (!active) return;
    if (flush) active.flush();
    active.drop = true; streams.delete(user); clearTimeout(active.timer); active.opus.destroy(); active.decoder.destroy();
    for (const part of active.parts) part.fill(0);
    active.parts = []; active.length = 0;
  }
  function stop({ flush = false } = {}) {
    drainingGeneration = flush ? generation : null;
    generation++;
    clearInterval(runtimeTimer); runtimeTimer = null; latestRuntime = null;
    for (const user of [...streams.keys()]) revoke(user, flush);
    const previous = connection; connection = null; sessionId = null;
    previous?.destroy();
    const draining = drainingGeneration;
    return Promise.allSettled([...pending]).then(() => { if (drainingGeneration === draining) drainingGeneration = null; });
  }
  async function start(id, host, { authorize = () => true } = {}) {
    const permitted = async () => { try { return await authorize() === true; } catch { return false; } };
    const session = store.get(id);
    if (session.status !== 'active') throw new ChronicleError('Resume the session before joining voice.');
    if (!session.campaign || typeof authorizeParticipant !== 'function' || typeof captureRuntime !== 'function') throw new ChronicleError('Current campaign membership and Obus host authority are required for voice.');
    const stopping = stop(), attempt = generation;
    await stopping;
    if (attempt !== generation) throw new ChronicleError('Voice connection was cancelled.');
    const guild = await client.guilds.fetch(config.guildId), member = await guild.members.fetch({ user: host, force: true });
    const channel = member.voice.channel;
    if (!channel || channel.type !== 2) throw new ChronicleError('Join a normal Discord voice channel in this campaign server first.');
    const hostAllowed = config.dmIds.includes(host) || (config.dmRoleId && member.roles.cache.has(config.dmRoleId)) || member.permissions.has(8n) || member.permissions.has(32n);
    if (!hostAllowed || !await permitted() || attempt !== generation || store.get(id).status !== 'active') throw new ChronicleError('Voice connection was cancelled or GM access changed.');
    const hostScope = Object.freeze({ campaign: session.campaign, owner: host, role: 'host' });
    const captured = await captureRuntime(hostScope, id);
    if (!validRuntime(captured) || !await permitted() || attempt !== generation || store.get(id).status !== 'active') throw new ChronicleError('Current Obus host authority is unavailable or voice was cancelled.');
    const initialRuntime = snapshotRuntime(captured);
    latestRuntime = initialRuntime;
    sessionId = id;
    const conn = joinVoiceChannel({ guildId: guild.id, channelId: channel.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
    connection = conn;
    conn.on('error', () => { if (connection === conn) { service.gap(id, 'Voice connection failed. Reconnect with /session voice.'); stop(); } });
    conn.on(VoiceConnectionStatus.Disconnected, () => { if (connection === conn) { service.gap(id, 'Voice disconnected; speech during the gap was not captured. Reconnect with /session voice.'); stop(); } });
    try { await entersState(conn, VoiceConnectionStatus.Ready, 20000); }
    catch { if (connection === conn) await stop(); else conn.destroy(); throw new ChronicleError('Could not connect to voice. Check the bot’s View Channel and Connect permissions, then retry.'); }
    if (!await permitted() || attempt !== generation || store.get(id).status !== 'active') {
      if (connection === conn) await stop(); else conn.destroy();
      throw new ChronicleError('Voice connection was cancelled or GM access changed.');
    }
    let refreshing = false;
    const refreshRuntime = () => {
      if (refreshing || connection !== conn) return;
      refreshing = true;
      const task = Promise.resolve().then(() => captureRuntime(hostScope, id)).then(runtime => {
        if (connection !== conn || generation !== attempt) return;
        if (!validRuntime(runtime) || runtime.bootEpoch !== initialRuntime.bootEpoch || runtime.generation !== initialRuntime.generation) {
          service.gap(id, 'Obus host authority changed; reconnect voice after the host is ready.'); stop(); return;
        }
        latestRuntime = snapshotRuntime(runtime);
      }).catch(() => { if (connection === conn) { latestRuntime = null; service.gap(id, 'Obus host authority could not be verified; speech capture is temporarily unavailable.'); } })
        .finally(() => { refreshing = false; pending.delete(task); });
      pending.add(task);
    };
    runtimeTimer = setInterval(refreshRuntime, 10000); runtimeTimer.unref?.();
    conn.receiver.speaking.on('start', user => {
      if (streams.has(user) || connection !== conn || sessionId !== id || store.get(id).status !== 'active' || !store.hasConsent(id, user)) return;
      const initial = channel.members.get(user);
      if (!allowed(initial)) return;
      const scope = Object.freeze({ campaign: session.campaign, owner: user, role: 'player' });
      const opus = conn.receiver.subscribe(user, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 } });
      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const active = { opus, decoder, parts: [], length: 0, captureEpoch: store.privacy(id, user).captureEpoch,
        context: null, at: null, scene: null, drop: false, timer: null, authorized: false, gapReported: false };
      const capturedAllowed = async context => {
        if (generation !== attempt && drainingGeneration !== attempt) return false;
        if (store.get(id).campaign !== context.scope.campaign || !['active', 'ending'].includes(store.get(id).status) ||
            !store.hasConsent(id, user) || store.privacy(id, user).captureEpoch !== context.capturedConsentEpoch) return false;
        if (await authorizeParticipant(context.scope) !== true) return false;
        const current = await guild.members.fetch({ user, force: true });
        return allowed(current) && current.voice.channelId === channel.id && (generation === attempt || drainingGeneration === attempt) &&
          store.hasConsent(id, user) && store.privacy(id, user).captureEpoch === context.capturedConsentEpoch;
      };
      active.flush = () => {
        if (active.drop || !active.length) return;
        const pcm = Buffer.concat(active.parts), context = active.context, at = active.at, scene = active.scene;
        for (const part of active.parts) part.fill(0);
        active.parts = []; active.length = 0; active.context = null;
        if (pcm.length < 19200 || !context || !store.hasConsent(id, user) || !['active', 'ending'].includes(store.get(id).status)) { pcm.fill(0); return; }
        if (pending.size >= 24) { pcm.fill(0); service.gap(id, 'Speech queue full; this segment was not captured.'); return; }
        const task = capturedAllowed(context).then(async accepted => {
          if (accepted) await service.speech(id, { user, speaker: initial.displayName.slice(0, 100), bytes: wav(pcm), at, scene,
            captureEpoch: context.capturedConsentEpoch, context, authorizeParticipant: () => capturedAllowed(context) });
        }).catch(() => service.gap(id, 'A voice segment was skipped because current campaign membership could not be verified.'))
          .finally(() => { pcm.fill(0); pending.delete(task); });
        pending.add(task);
      };
      streams.set(user, active);
      const authorizing = Promise.resolve().then(() => authorizeParticipant(scope)).then(accepted => {
        if (streams.get(user) !== active || active.drop) return;
        if (accepted === true && generation === attempt && store.hasConsent(id, user) && store.privacy(id, user).captureEpoch === active.captureEpoch) active.authorized = true;
        else revoke(user);
      }).catch(() => { if (streams.get(user) === active) { revoke(user); service.gap(id, 'Speech capture skipped a participant whose campaign membership could not be verified.'); } })
        .finally(() => pending.delete(authorizing));
      pending.add(authorizing);
      active.timer = setTimeout(() => { active.flush(); revoke(user); service.gap(id, 'A voice stream exceeded its receive window. The speaker may need to pause briefly to start a fresh stream.'); }, 10 * 60000);
      decoder.on('data', buffer => {
        if (active.drop || !store.hasConsent(id, user) || store.privacy(id, user).captureEpoch !== active.captureEpoch || store.get(id).status !== 'active') { buffer.fill(0); revoke(user); return; }
        if (!active.authorized || !validRuntime(latestRuntime)) {
          buffer.fill(0);
          if (!active.gapReported) { active.gapReported = true; service.gap(id, 'Speech received before current membership and Obus host authority were verified was discarded.'); }
          if (!validRuntime(latestRuntime)) refreshRuntime();
          return;
        }
        if (!active.length) {
          active.context = Object.freeze({ scope, session: id, requestId: crypto.randomUUID(), capturedRuntime: snapshotRuntime(latestRuntime), capturedConsentEpoch: active.captureEpoch });
          active.at = Date.now(); active.scene = store.get(id).scene?.seq ?? null;
        }
        active.parts.push(buffer); active.length += buffer.length;
        if (active.length >= 192000 * 20) active.flush();
      });
      const finish = () => { if (streams.get(user) !== active) return; active.flush(); revoke(user); };
      decoder.on('end', finish);
      const failed = () => { if (streams.get(user) === active) { revoke(user); service.gap(id, 'A voice segment could not be decoded; typed capture remains available.'); } };
      opus.on('error', failed); decoder.on('error', failed); opus.pipe(decoder);
    });
    store.transaction(() => store.append(id, `voice:${Date.now()}`, 'session', { text: `Voice scribe connected to ${channel.name}. Only opted-in campaign members are transcribed. Each Discord account is its speaker label; shared microphones cannot identify individual people.` }));
  }
  return { start, stop, revoke, status: () => connection ? `connected (${connection.state.status})` : 'disconnected' };
}
