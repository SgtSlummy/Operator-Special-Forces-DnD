import { createHash } from 'node:crypto';
import { ChronicleError, bounded } from '../chronicle/store.mjs';

const option = (type, name, description, extra = {}) => ({ type, name, description, ...extra });
const sub = (name, description, options = []) => option(1, name, description, { options });
export const SESSION_COMMAND = {
  name: 'session', description: 'DM read-aloud assistant and shared session chronicle', type: 1,
  options: [
    sub('start', 'DM/Admin: start a story session', [option(3, 'title', 'Session title', { required: true, max_length: 100 }), option(3, 'mode', 'Who runs the story?', { required: true, choices: [{ name: 'Human DM', value: 'human' }, { name: 'Automated arcade', value: 'arcade' }] }), option(4, 'minutes', 'Minutes between summaries (1–180; default 10)', { min_value: 1, max_value: 180 }), option(5, 'images', 'Automatically request an illustration for each published scene')]),
    sub('consent', 'Turn capture of your typed messages and voice on or off for this session', [option(5, 'enabled', 'Allow your speech to be transcribed and saved to the shared story record', { required: true }), option(5, 'external', 'Allow eligible excerpts to be processed by host-enabled external AI routes')]),
    sub('status', 'Show session state, interval and your capture setting'),
    sub('scene', 'DM/Admin: publish only what all players can observe', [option(3, 'title', 'Scene title', { required: true, max_length: 100 }), option(3, 'description', 'Public observable facts ONLY; never DM secrets', { required: true, max_length: 4000 }), option(5, 'image', 'Request a scene illustration'), option(3, 'art', 'Optional approved campaign art ID', { max_length: 100 })]),
    sub('cue', 'DM/Admin: privately draft a passage to read aloud for the current scene'),
    sub('image', 'Request a shared illustration of the current public scene'),
    sub('note', 'Add a public story note (proposals remain proposals)', [option(3, 'text', 'Story note', { required: true, max_length: 4000 })]),
    sub('correct', 'Correct your transcript; DM/Admin can correct any public source entry', [option(4, 'entry', 'Number after E in the entry tag', { required: true, min_value: 1 }), option(3, 'text', 'Corrected text, retained with an audit trail', { required: true, max_length: 4000 })]),
    sub('minutes', 'DM/Admin: change the summary interval', [option(4, 'value', 'Minutes between summaries', { required: true, min_value: 1, max_value: 180 })]),
    sub('pause', 'DM/Admin: stop voice and typed capture for a break'),
    sub('resume', 'DM/Admin: resume the scribe; reconnect voice separately'),
    sub('summary', 'DM/Admin: summarize new story evidence now'),
    sub('voice', 'DM/Admin: listen in your current voice channel (opted-in speakers only)'),
    sub('leave', 'DM/Admin: disconnect voice capture'),
    sub('end', 'DM/Admin: stop capture and publish the complete illustrated recap'),
    sub('retry-delivery', 'DM/Admin: retry known failed story deliveries; uncertain sends remain paused'),
  ],
};
export function chronicleIdentity(interaction, config) {
  const member = interaction.member, user = member?.user?.id;
  if (interaction.guild_id !== config.guildId || ![config.channelId, config.journalChannelId].includes(interaction.channel_id) || !user || member.user.bot || !Array.isArray(member.roles)) throw new ChronicleError('Use this command in the configured campaign or story channel.');
  let permissions = 0n; try { permissions = BigInt(member.permissions ?? '0'); } catch { /* Invalid permissions never grant host access. */ }
  const host = config.dmIds.includes(user) || (config.dmRoleId && member.roles.includes(config.dmRoleId)) || Boolean(permissions & (8n | 32n));
  const player = config.playerIds.includes(user) || (config.playerRoleId && member.roles.includes(config.playerRoleId));
  if (!host && !player) throw new ChronicleError('The session companion is available to current campaign members.');
  return { user, host: Boolean(host), speaker: (member.nick || member.user.global_name || member.user.username || user).slice(0, 100) };
}
export function createChronicleAdapter({ store, service, config, transport, voice, log = () => {} }) {
  let commands = Promise.resolve(); let delivering = null;
  store.db.exec('CREATE TABLE IF NOT EXISTS delivery_parts(id TEXT,part INTEGER,receipt TEXT NOT NULL,PRIMARY KEY(id,part))');
  const reply = (i, content) => transport.respond(i.id, i.token, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
  async function handle(i, { acknowledged: alreadyAcknowledged = false } = {}) {
    if (i.type !== 2 || i.data?.name !== 'session') return false;
    let acknowledged = alreadyAcknowledged === true;
    try {
      const actor = chronicleIdentity(i, config), action = i.data.options?.[0]?.name;
      const values = Object.fromEntries((i.data.options?.[0]?.options ?? []).map(o => [o.name, o.value]));
      if (!SESSION_COMMAND.options.some(o => o.name === action)) throw new ChronicleError('Unknown session command.');
      if (!['consent', 'status', 'note', 'correct', 'image'].includes(action) && !actor.host) throw new ChronicleError('Only the DM or a server administrator can use that control.');
      if (!acknowledged) { await transport.respond(i.id, i.token, { type: 5, data: { flags: 64 } }); acknowledged = true; }
      const task = (action === 'consent' ? Promise.resolve() : commands).then(async () => {
        const current = chronicleIdentity({ ...i, member: await transport.member(actor.user) }, config);
        if (current.user !== actor.user || (!['consent', 'status', 'note', 'correct', 'image'].includes(action) && !current.host)) throw new ChronicleError('Your current campaign role no longer permits this command.');
        actor.host = current.host; actor.speaker = current.speaker;
        let result, s = store.current(config.campaignId);
        if (action === 'start') {
          s = store.start({ campaign: config.campaignId, title: values.title, mode: values.mode, minutes: values.minutes ?? 10,
            autoImages: values.images ?? false, host: actor.user, channel: config.journalChannelId, sourceChannel: config.channelId, requestId: i.id });
          result = `Session started: ${s.title}. Shared story record: <#${s.channel}>. Each speaker should /session consent enabled:true. Use /session scene for public scene facts, then /session cue for private read-aloud text. Use /session voice to connect to your voice channel.`;
        } else {
          if (!s && ['status', 'end', 'retry-delivery'].includes(action)) s = store.latest(config.campaignId);
          if (!s) throw new ChronicleError('The DM must /session start first.');
          if (action === 'status') result = `${s.title} · ${s.status} · ${s.mode} DM\nSession ${s.id}\nSummaries: every ${s.minutes} minutes${s.status === 'active' ? `; next due ${new Date(s.nextDue).toISOString()}` : ''}\nYour capture: ${store.hasConsent(s.id, actor.user) ? 'on' : 'off'}\nExternal AI processing: ${store.privacy(s.id, actor.user).external ? 'permitted' : 'off'}\nVoice: ${voice?.status() ?? 'not configured'}\nStory channel: <#${s.channel}>\nPending story deliveries: ${store.deliveryState(s.id).pending}; failed: ${store.deliveryState(s.id).failed}; need review: ${store.deliveryState(s.id).uncertain}${s.recap ? '\nIllustrated recap saved and queued for the story channel.' : ''}`;
          else if (action === 'consent') {
            if (!['active', 'paused'].includes(s.status)) throw new ChronicleError('Capture is closed for this session.');
            if (typeof values.enabled !== 'boolean') throw new ChronicleError('Choose capture on or off.');
            if (values.external !== undefined && typeof values.external !== 'boolean') throw new ChronicleError('Choose external processing on or off.');
            store.transaction(() => {
              if (store.find(s.id, `consent:${i.id}`)) return;
              store.consent(s.id, actor.user, values.enabled);
              if (values.external !== undefined) store.externalConsent(s.id, actor.user, values.external);
              store.append(s.id, `consent:${i.id}`, 'session', { text: `${actor.speaker}: capture ${values.enabled ? 'on' : 'off'}; external AI processing ${store.privacy(s.id, actor.user).external ? 'permitted' : 'off'}.`, user: actor.user });
            });
            if (!values.enabled) voice?.revoke(actor.user);
            result = `Your capture is ${values.enabled ? 'on. Typed messages in the campaign channel and your connected Discord voice stream can now be saved; speech is processed locally through Obus.' : 'off. Existing records remain; new speech and typed messages will not be saved.'}`;
          } else if (['pause', 'resume', 'minutes'].includes(action)) {
            s = store.control(s.id, action, i.id, values.value);
            if (action === 'pause') await voice?.stop();
            result = `${s.status} · summaries every ${s.minutes} minutes.${action === 'resume' ? ' Use /session voice to reconnect voice capture.' : ''}`;
          } else if (action === 'scene') {
            const e = service.scene(s.id, { title: values.title, text: values.description, requestId: i.id, image: values.image, approvedImage: values.art });
            result = `Published scene E${e.seq}. ${s.mode === 'human' ? 'Use /session cue for your private read-aloud passage.' : 'The arcade narrator can use these public scene facts.'}`;
          } else if (action === 'cue') result = await service.cue(s.id);
          else if (action === 'image') { service.requestImage(s.id, i.id); result = 'Shared scene image queued. It will appear in the story channel when ready.'; }
          else if (action === 'note') {
            if (s.status !== 'active') throw new ChronicleError('Resume the session before adding a story note.');
            const e = store.transaction(() => store.append(s.id, `note:${i.id}`, 'note', { text: bounded(values.text, 4000), user: actor.user, speaker: actor.speaker, scene: s.scene?.seq ?? null }));
            result = `Public story note saved as E${e.seq}.`;
          } else if (action === 'correct') {
            const e = store.correct(s.id, values.entry, values.text, actor.user, actor.host, i.id); result = `Correction E${e.seq} saved. It supersedes E${values.entry}; the original remains visible for context. Subsequent summaries and the final recap use the corrected text.`;
          } else if (action === 'summary') { const e = await service.summarize(s.id, { force: true }); result = e ? 'Summary saved for the story channel.' : 'No new story evidence to summarize.'; }
          else if (action === 'voice') { if (!voice) throw new ChronicleError('Voice capture is not configured.'); await voice.start(s.id, actor.user); result = 'Voice connected. Only current campaign members who opted in are transcribed. Use /session leave or /session pause to disconnect.'; }
          else if (action === 'leave') { await voice?.stop(); result = 'Voice capture disconnected. Typed capture continues unless you pause the session.'; }
          else if (action === 'retry-delivery') { const count = store.retryDeliveries(s.id, i.id); result = `Retry requested for ${count} saved deliveries. Uncertain sends stay paused until their outcome is reviewed in Discord.`; }
          else if (action === 'end') { await voice?.stop({ flush: true }); await service.end(s.id); result = 'Session ended. The complete illustrated recap is saved and queued for the story channel.'; }
        }
        const parts = result.match(/[\s\S]{1,1900}/g) ?? ['Done.'];
        await transport.edit(i.application_id, i.token, { content: parts[0], allowed_mentions: { parse: [] } });
        for (const content of parts.slice(1)) await transport.followup(i.application_id, i.token, { content, flags: 64, allowed_mentions: { parse: [] } });
      });
      if (action !== 'consent') commands = task.catch(() => {}); await task;
    } catch (error) {
      log({ outcome: 'chronicle_command_failed', expected: error instanceof ChronicleError });
      const message = error instanceof ChronicleError ? error.message : 'The session request could not finish. Check /session status; saved entries are retained.';
      try { if (acknowledged) await transport.edit(i.application_id, i.token, { content: message, allowed_mentions: { parse: [] } }); else await reply(i, message); } catch { log({ outcome: 'chronicle_reply_failed' }); }
    }
    return true;
  }
  async function message(packet) {
    if (packet.guild_id !== config.guildId || packet.channel_id !== config.channelId || !packet.author?.id || packet.author.bot || packet.webhook_id || !packet.content?.trim()) return;
    const s = store.current(config.campaignId); if (!s || s.status !== 'active' || !store.hasConsent(s.id, packet.author.id)) return;
    const captureEpoch = store.privacy(s.id, packet.author.id).captureEpoch;
    const member = await transport.member(packet.author.id);
    const actor = chronicleIdentity({ guild_id: packet.guild_id, channel_id: packet.channel_id, member: { ...member, user: packet.author } }, config);
    if (store.current(config.campaignId)?.id !== s.id) return;
    // Never scrape old history, DMs, other channels, attachments or bot output.
    store.record(s.id, `discord:${packet.id}`, { user: actor.user, speaker: actor.speaker, text: packet.content, at: Date.parse(packet.timestamp) || Date.now(), captureEpoch });
  }
  async function flush() {
    if (delivering) return delivering;
    delivering = (async () => {
      for (const row of store.readyDeliveries()) {
        let sending = false;
        try {
          const s = store.get(row.session), payloads = await service.delivery(row);
          for (let part = 0; part < payloads.length; part++) {
            if (store.db.prepare('SELECT receipt FROM delivery_parts WHERE id=? AND part=?').get(row.id, part)) continue;
            const nonce = createHash('sha256').update(`${row.id}:${part}`).digest('hex').slice(0, 24);
            // Persist uncertainty before the external call so a process crash
            // after acceptance cannot silently resend an unacknowledged part.
            store.deliverySending(row.id); sending = true;
            const response = await transport.send(s.channel, { ...payloads[part], allowed_mentions: { parse: [] }, nonce, enforce_nonce: true });
            if (typeof response?.id !== 'string' || !response.id) throw new Error('Missing delivery receipt.');
            store.transaction(() => {
              store.db.prepare('INSERT OR IGNORE INTO delivery_parts VALUES(?,?,?)').run(row.id, part, response.id);
              store.clearDeliveryUncertain(row.id);
            });
            sending = false;
          }
          store.delivered(row.id, 'complete');
        } catch (error) {
          const status = Number(error?.status), rejected = Number.isInteger(status) && status >= 400 && status < 500;
          const uncertain = sending && !rejected;
          store.deferDelivery(row.id, { uncertain });
          log({ outcome: uncertain ? 'chronicle_delivery_needs_review' : 'chronicle_delivery_retry_deferred' });
        }
      }
    })().finally(() => { delivering = null; }); return delivering;
  }
  return { handle, message, flush, close: async () => { await commands; await delivering; } };
}
