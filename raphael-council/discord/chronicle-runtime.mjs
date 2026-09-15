import { join } from 'node:path';
import { ChronicleStore } from '../chronicle/store.mjs';
import { createStoryProvider } from '../chronicle/provider.mjs';
import { createVoiceCapture } from '../chronicle/voice.mjs';
import { SESSION_COMMAND } from './chronicle-adapter.mjs';
import { createChronicleRuntimeCore } from './chronicle-core.mjs';

// Operator defaults stay outside the portable library. Existing bot callers keep
// this wrapper; Davy supplies its own provider, voice ownership adapter and store.
export function createChronicleRuntime({ client, config, images, transport, log = () => {}, authorizeCommand = () => false,
  provider, makeVoice = createVoiceCapture,
  store = new ChronicleStore(join(config.chronicleDir, 'chronicle.sqlite')), music = null }) {
  const story = provider ?? createStoryProvider({ store, campaigns: [config.campaignId] });
  return createChronicleRuntimeCore({ client, config, images, transport, log, authorizeCommand, provider: story, makeVoice, store, music });
}

export async function registerSessionCommand(client, config) {
  const endpoint = `/applications/${client.application.id}/guilds/${config.guildId}/commands`;
  const existing = await client.rest.get(endpoint);
  const collision = existing.find(command => command.name === SESSION_COMMAND.name && command.type === SESSION_COMMAND.type);
  if (collision && collision.description !== SESSION_COMMAND.description) {
    throw new Error('An unrelated /session command already exists. It was left unchanged.');
  }
  // Individual upsert preserves all unrelated commands on the existing bot.
  return client.rest.post(endpoint, { body: SESSION_COMMAND });
}
