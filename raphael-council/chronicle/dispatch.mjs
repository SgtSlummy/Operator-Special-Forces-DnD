import { createHash, randomUUID } from 'node:crypto';
import { ChronicleCommands } from './commands.mjs';
import { chronicleIdentity } from '../discord/chronicle-adapter.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });

// The bot owns voice operations. Neither client can supply campaign identity,
// Discord permissions, provider credentials, or a second gateway connection.
export function createChronicleDispatcher({ store, service, voice, config, transport,
  authorize = () => false, queue = new ChronicleCommands(store), log = () => {}, renewEveryMs = 10000 }) {
  const worker = `chronicle:${randomUUID()}`;
  let running = null, closing = false;
  async function execute(claim) {
    const { scope, input } = claim;
    const authorized = async () => {
      if (scope.campaign !== config.campaignId || scope.role !== 'host' || !await authorize(scope)) throw fail('FORBIDDEN', 'The GM no longer has access to this campaign.');
      const member = await transport.member(scope.owner);
      const identity = chronicleIdentity({ guild_id: config.guildId, channel_id: config.channelId, member }, config);
      if (identity.user !== scope.owner || !identity.host || !await authorize(scope)) throw fail('FORBIDDEN', 'The GM no longer has access to this campaign.');
    };
    await authorized();
    const actionId = `web:${createHash('sha256').update(`${scope.owner}:${input.requestId}`).digest('hex')}`;
    const source = `web-command:${actionId}`;
    let session = input.sessionId ? store.get(input.sessionId) : null;
    if (session && session.campaign !== scope.campaign) throw fail('FORBIDDEN', 'This session belongs to another campaign.');
    if (input.type === 'start') session = store.all().find(value => value.campaign === scope.campaign && value.requestId === actionId) ?? null;
    const saved = session && store.find(session.id, source);
    if (saved) return saved.result;
    // Recognize effects committed before a worker stopped, without repeating them.
    const controlApplied = session && ['pause', 'resume'].includes(input.type) && store.find(session.id, `control:${actionId}`);
    const retryApplied = session && input.type === 'retry-delivery' && store.find(session.id, `delivery-retry:${actionId}`);
    const alreadyApplied = controlApplied || retryApplied || input.type === 'start' && session || input.type === 'end' && session?.status === 'ended';
    if (!alreadyApplied) {
      const current = store.current(scope.campaign) || (input.type === 'retry-delivery' ? store.latest(scope.campaign) : null);
      if (input.type === 'start' ? Boolean(current) : !session || current?.id !== session.id) throw fail('STALE_SESSION', 'The active session changed. Refresh the chronicle.');
      if ((session ? store.revision(session.id) : 0) !== input.expectedRevision) throw fail('STALE_REVISION', 'The session changed before this command ran. Refresh and try again.');
      if (session && !['active', 'paused'].includes(session.status) && !['end', 'retry-delivery'].includes(input.type)) throw fail('STALE_SESSION', 'This session is closing or ended.');
    }
    // No awaits separate the final lease check from synchronous state changes.
    if (closing) throw fail('COMMAND_CANCELLED', 'The host is stopping. Refresh after restart.');
    queue.renew(claim);
    // A committed effect is reconciled without replaying global voice actions:
    // a later resume or a new session may already own the voice connection.
    if (!alreadyApplied) switch (input.type) {
      case 'start':
        session = store.start({ campaign: scope.campaign, title: input.title, mode: input.mode, minutes: input.minutes,
          host: scope.owner, channel: config.journalChannelId, sourceChannel: config.channelId, requestId: actionId });
        break;
      case 'pause':
        store.control(session.id, 'pause', actionId); await voice.stop(); break;
      case 'resume':
        store.control(session.id, 'resume', actionId); break;
      case 'voice':
        await voice.start(session.id, scope.owner, { authorize: async () => {
          if (closing || !await authorize(scope)) return false;
          try { queue.renew(claim); return true; } catch { return false; }
        } }); break;
      case 'leave':
        await voice.stop(); break;
      case 'summary':
        await service.summarize(session.id, { force: true }); break;
      case 'retry-delivery':
        store.retryDeliveries(session.id, actionId); break;
      case 'end':
        await voice.stop({ flush: true }); await service.end(session.id); break;
      default: throw fail('INVALID_COMMAND', 'Unknown session control.');
    }
    const result = { sessionId: session.id, type: input.type, status: store.get(session.id).status };
    // Fence publication as well as claims: an expired worker cannot acknowledge
    // another worker's operation or create a misleading successful receipt.
    return store.transaction(() => {
      queue.renew(claim);
      store.append(session.id, source, 'command-receipt', { result }, false);
      return result;
    });
  }
  return {
    queue,
    tick() {
      if (closing) return Promise.resolve();
      if (running) return running;
      const claim = queue.claim(worker, { campaign: config.campaignId });
      if (!claim) return Promise.resolve();
      const timer = setInterval(() => { try { queue.renew(claim); } catch { /* Final lease check fences this worker. */ } }, renewEveryMs);
      timer.unref?.();
      running = (async () => {
        try { queue.complete(claim, { result: await execute(claim) }); }
        catch (error) {
          try { queue.complete(claim, { error }); }
          catch { log({ outcome: 'chronicle_command_lease_lost' }); }
        } finally { clearInterval(timer); }
      })().finally(() => { running = null; });
      return running;
    },
    async close() { closing = true; await running; },
  };
}
