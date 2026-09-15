import { createHash } from 'node:crypto';
import { ChronicleError } from './store.mjs';
import { ObusTransport } from '../ai/obus.mjs';
import { getPlatform } from '../auth/runtime.mjs';
import { getGameStore } from '../game/storage.mjs';
import { createLocalObusHostControl } from '../ai/host-config.mjs';
import { createObusEvidenceBridge } from './obus-evidence.mjs';
import { createObusChronicleProvider } from './obus-provider.mjs';

export function createStoryProvider({ ai, transport = new ObusTransport(), authorizeParticipant, authorizeCommand,
  store, campaigns, hostControl, authorizeEvidence } = {}) {
  const participant = async scope => {
    try {
      if (!scope || !['host', 'player'].includes(scope.role)) return false;
      if (authorizeParticipant) return await authorizeParticipant(scope) === true;
      return ['host', 'player'].includes(getGameStore().member({ campaign: scope.campaign, owner: scope.owner }));
    } catch { return false; }
  };
  const host = async scope => {
    try {
      if (scope?.role !== 'host') return false;
      return authorizeCommand ? await authorizeCommand(scope) === true : getGameStore().member({ campaign: scope.campaign, owner: scope.owner }) === 'host';
    } catch { return false; }
  };
  if (store) {
    // Allocate private credentials lazily: unavailable AI must not prevent the
    // bot from accepting manual commands or retaining campaign evidence.
    let control = hostControl;
    const selectedControl = () => control ??= createLocalObusHostControl();
    const bridge = createObusEvidenceBridge({ store, campaigns, allowStoreSync: true,
      hostControl: {
        getRuntime: input => selectedControl().getRuntime(input),
        syncEvidence: input => selectedControl().syncEvidence(input),
      },
      authorizeCommand: authorizeEvidence ?? (scope => {
        try {
          // Custom async authorization needs its own explicit synchronous
          // evidence authorizer; it cannot silently inherit platform access.
          return !authorizeCommand && getGameStore().member({ campaign: scope.campaign, owner: scope.owner }) === 'host';
        } catch { return false; }
      }),
    });
    return createObusChronicleProvider({ transport, campaigns, evidenceBridge: bridge,
      authorizeCommand: host, authorizeParticipant: participant });
  }
  return {
    authorizeParticipant: participant,
    async captureRuntime(scope, session) {
      if (!await host(scope)) throw new ChronicleError('Current campaign GM access is required for voice capture.');
      const runtime = await transport.runtime(scope, session);
      if (!await host(scope)) throw new ChronicleError('Current campaign GM access is required for voice capture.');
      return runtime;
    },
    async write(kind, evidence, context) {
      if (!context?.campaign || !context?.session || !context?.owner) throw new ChronicleError('Campaign-scoped Obus context is required.');
      const requestId = createHash('sha256').update(JSON.stringify({ kind, evidence, context })).digest('hex');
      const result = await (ai || getPlatform().ai).run({ campaign: context.campaign, owner: context.owner, role: 'host' }, {
        requestId, session: context.session, task: kind,
        query: `Produce ${kind} from the supplied session evidence. Cite E references; preserve uncertainty.`,
        evidence, sourceRevision: context.sourceRevision, exportable: context.exportable === true,
      });
      if (result.status !== 'ready') throw new ChronicleError('Obus story generation is unavailable. The source record is saved.');
      return result.text;
    },
    async transcribe(bytes, context) {
      if (!Buffer.isBuffer(bytes) || !context?.capturedRuntime || !context?.session || !context?.requestId || !Number.isSafeInteger(context.capturedConsentEpoch) || context.capturedConsentEpoch < 0) throw new ChronicleError('Captured speech scope and current campaign membership are required.');
      const saved = Object.freeze({ scope: Object.freeze({ ...context.scope }), session: context.session, requestId: context.requestId,
        capturedRuntime: Object.freeze({ ...context.capturedRuntime }), capturedConsentEpoch: context.capturedConsentEpoch });
      const audio = Buffer.from(bytes);
      try {
        if (!await participant(saved.scope)) throw new ChronicleError('Captured speech scope and current campaign membership are required.');
        const text = await transport.transcribe(audio, saved);
        if (!await participant(saved.scope)) throw new ChronicleError('Campaign membership changed during transcription.');
        return text;
      } finally { audio.fill(0); }
    },
  };
}
