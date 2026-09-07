import { createHash, randomUUID } from 'node:crypto';
import { ChronicleService } from '../chronicle/service.mjs';
import { createChronicleAdapter } from './chronicle-adapter.mjs';
import { createChronicleDispatcher } from '../chronicle/dispatch.mjs';

// Explicit dependencies keep the portable library independent of the Operator
// platform, provider administration and any particular Discord voice connection.
// The caller transfers lifecycle ownership of the chronicle store to this runtime.
export function createChronicleRuntimeCore({ client, config, images, transport, log = () => {}, authorizeCommand = () => false,
  provider, makeVoice, store, music = null }) {
  if (!provider || typeof provider.write !== 'function' || typeof makeVoice !== 'function' || !store?.db || typeof store.close !== 'function') {
    throw new TypeError('Supply the Obus story provider, shared voice factory and chronicle store explicitly.');
  }
  const service = new ChronicleService({ store, provider, images, dataDir: config.chronicleDir });
  const voice = makeVoice({ client, config, store, service });
  if (!voice || typeof voice.start !== 'function' || typeof voice.stop !== 'function') throw new TypeError('Supply a voice adapter with start and stop operations.');
  const adapter = createChronicleAdapter({ store, service, config, transport, voice, log });
  service.recover();
  const dispatcher = createChronicleDispatcher({ store, service, voice, config, transport, authorize: authorizeCommand, log });
  let closing = false, running = null, closingWork = null, storeClosed = false;
  return {
    store, service, voice, music,
    handle: (interaction, options) => closing ? false : adapter.handle(interaction, options),
    async packet(packet) {
      if (closing) return;
      if (packet.t === 'MESSAGE_CREATE') await adapter.message(packet.d);
      if (['MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_DELETE_BULK'].includes(packet.t)) {
        const data = packet.d;
        if (data.guild_id !== config.guildId || data.channel_id !== config.channelId) return;
        const session = store.current(config.campaignId);
        if (!session) return;
        if (packet.t === 'MESSAGE_UPDATE' && typeof data.content !== 'string') return;
        const deleted = packet.t !== 'MESSAGE_UPDATE';
        for (const id of packet.t === 'MESSAGE_DELETE_BULK' ? (data.ids || []) : [data.id]) {
          if (!id) continue;
          store.reviseMessage(session.id, id, { text: data.content, deleted,
            requestId: `${id}:${deleted ? 'deleted' : data.edited_timestamp || createHash('sha256').update(data.content).digest('hex')}` });
        }
      }
    },
    async gap() {
      if (closing) return;
      const session = store.current(config.campaignId);
      if (!session || session.status !== 'active') return;
      store.control(session.id, 'pause', `gateway-gap:${randomUUID()}`);
      await voice.stop();
      service.gap(session.id, 'Discord disconnected. Capture is paused; messages and speech during the gap were not captured. Use /session resume and /session voice after reconnecting.');
    },
    tick() {
      if (closing) return Promise.resolve();
      // Poll controls independently while background Obus work is in flight.
      const commands = dispatcher.tick();
      if (!running) running = (async () => { await service.tick(); await adapter.flush(); })()
        .catch(() => log({ outcome: 'chronicle_work_deferred' })).finally(() => { running = null; });
      return Promise.allSettled([commands, running]);
    },
    close() {
      if (closingWork) return closingWork;
      closing = true;
      closingWork = (async () => {
        const failures = [];
        const attempt = async (stage, work) => {
          try { await work(); return true; }
          catch {
            failures.push(new Error(`Chronicle shutdown stage failed: ${stage}.`));
            try { log({ outcome: 'chronicle_shutdown_deferred', stage }); } catch { /* Logging cannot interrupt cleanup. */ }
            return false;
          }
        };
        const stopped = await attempt('capture', () => voice.stop({ flush: true }));
        // A failed injected stop must not leave the session admitting new audio.
        if (!stopped) await attempt('pause', () => service.recover());
        await attempt('commands', () => dispatcher.close());
        await attempt('interactions', () => adapter.close());
        const detached = await attempt('capture-final', () => voice.stop({ flush: true }));
        await attempt('background', () => running);
        await attempt('speech', () => service.close());
        await attempt('pause-final', () => service.recover());
        await attempt('deliveries', () => adapter.flush());
        // The gateway must retain this runtime if its voice adapter cannot
        // confirm detachment. A later close call can retry without new work.
        if (detached) await attempt('storage', () => { store.close(); storeClosed = true; });
        if (failures.length) throw new AggregateError(failures, 'Chronicle shutdown did not finish cleanly.');
      })().catch(error => { if (!storeClosed) closingWork = null; throw error; });
      return closingWork;
    },
  };
}
