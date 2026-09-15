import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import { ChronicleError } from './store.mjs';
import { createVoiceReceiver } from './voice-receiver.mjs';
export { wav } from './voice-receiver.mjs';

// The standalone Operator bot owns this connection. Davy supplies its existing
// music player's capture lease to createVoiceReceiver instead of this strategy.
export function createVoiceCapture(options) {
  return createVoiceReceiver({ ...options, openConnection: async ({ guild, channel, authorize, onInvalidate, signal }) => {
    if (signal.aborted || await authorize() !== true || signal.aborted) throw new ChronicleError('Voice connection was cancelled or GM access changed.');
    const connection = joinVoiceChannel({ guildId: guild.id, channelId: channel.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
    const streams = new Set(), listeners = new Set();
    let active = true, released = false;
    const release = () => {
      if (released) return true;
      active = false;
      signal.removeEventListener('abort', release);
      connection.off?.('error', invalidated);
      connection.off?.(VoiceConnectionStatus.Disconnected, invalidated);
      for (const listener of listeners) connection.receiver.speaking.off('start', listener);
      listeners.clear();
      for (const stream of streams) stream.destroy();
      streams.clear();
      if (connection.state?.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      released = true;
      return true;
    };
    const invalidated = () => { if (active) { release(); onInvalidate(); } };
    signal.addEventListener('abort', release, { once: true });
    connection.on('error', invalidated);
    connection.on(VoiceConnectionStatus.Disconnected, invalidated);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
      if (!active || signal.aborted || await authorize() !== true || signal.aborted) throw new ChronicleError('Voice connection was cancelled or GM access changed.');
    } catch (error) {
      release();
      if (error instanceof ChronicleError) throw error;
      throw new ChronicleError('Could not connect to voice. Check the bot’s View Channel and Connect permissions, then retry.');
    }
    return {
      get active() { return active && !signal.aborted; },
      async subscribe(user, { authorize: authorizeSpeaker, options: subscribeOptions }) {
        if (!active || signal.aborted || await authorizeSpeaker() !== true || !active || signal.aborted) throw new ChronicleError('Current speaker consent is required.');
        const stream = connection.receiver.subscribe(user, subscribeOptions);
        streams.add(stream); stream.once('close', () => streams.delete(stream));
        return stream;
      },
      onSpeaking(listener) {
        if (!active) throw new ChronicleError('Voice capture was cancelled.');
        connection.receiver.speaking.on('start', listener); listeners.add(listener);
        return () => { connection.receiver.speaking.off('start', listener); listeners.delete(listener); };
      },
      release,
    };
  } });
}
