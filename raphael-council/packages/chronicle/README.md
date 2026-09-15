# @operator/chronicle

Portable session chronicle for Davy Jones's existing Discord gateway. The package includes transcripts, consent and corrections, a durable command queue, session controls, reports and delivery receipts. It contains no Discord login, gateway creation, provider configuration, game web host, or default voice receiver.

## Requirements and installation

- Node.js 22.16.0 or later, including `node:sqlite`. Chronicle transactions use `DatabaseSync.isTransaction`, introduced in Node22.16.0; see the [Node SQLite API history](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html#databaseistransaction).
- Pinned runtime dependencies: `@napi-rs/canvas` 1.0.8, `@discordjs/voice` 0.19.2 and `prism-media` 1.3.5. They remain external npm dependencies; the canvas native binary is not embedded in the JavaScript bundle. Install dependencies for the machine running Davy Jones.
- Build dependency in the source workspace: `esbuild` exactly 0.27.3.
- An existing authenticated Discord client, an Obus-backed provider, and a voice adapter owned by the existing Davy gateway.

Install the local tarball in the Davy project with `npm install /absolute/path/operator-chronicle-0.1.2.tgz`. This package is private and is not published to a registry. Installing it does not start any process or connect to Discord.

## Integration

```js
import { createChronicleRuntime, ChronicleStore, SESSION_COMMAND } from '@operator/chronicle';

const chronicle = createChronicleRuntime({
  client: existingDavyClient,
  config: chronicleConfig,
  transport: existingDiscordTransport,
  provider: obusStoryProvider,
  makeVoice: createSharedDavyCapture,
  store: new ChronicleStore(absoluteChronicleDatabasePath),
  authorizeCommand: scope => currentGameMembership(scope) === 'host',
});

// Existing gateway handlers forward relevant packets/interactions once.
await chronicle.packet(rawPacket);
const handled = await chronicle.handle(rawInteraction, { acknowledged: true });
// acknowledged:true is only valid after the existing handler deferred privately.

// The existing host owns scheduling and shutdown.
await chronicle.tick();
await chronicle.gap(); // On gateway disconnect, pause capture and record a gap.
await chronicle.close();
```

Compose this inside the existing bot. Do not import Operator's standalone `discord/bot.mjs`. Register `SESSION_COMMAND` deliberately through Davy's existing command registration flow; the library never registers commands automatically. A successful composition does not establish live Discord or Obus readiness.

`config` supplies `campaignId`, `guildId`, `channelId`, `journalChannelId`, `dmIds`, `dmRoleId`, `playerIds`, `playerRoleId`, and the absolute `chronicleDir`. The dedicated database path and campaign must match the game web/API configuration. Keep live data outside synced source folders. The runtime takes ownership of its injected chronicle connection and closes it during shutdown; do not pass a shared game database connection or use that connection after `close()`. Concurrent `close()` calls join the same drain. Handle a rejected close before tearing down the host transport: if capture detachment could not be confirmed, the dedicated store remains open and a later close can retry cleanup while new work stays blocked.

The package exports `createChronicleRuntimeCore` and its alias `createChronicleRuntime`, `ChronicleStore`, `ChronicleError`, `ChronicleCommands`, `ChronicleCommandError`, `SESSION_COMMAND`, `createDavyChronicleHost`, `discordCampaignBindings`, `createVoiceReceiver`, and `createAdaptiveMusic`.

### Required adapters

`provider.write(kind, evidence, context)` returns generated text through Obus. Speech requires `provider.authorizeParticipant(scope)`, returning exactly `true` only for current campaign membership; `provider.captureRuntime(hostScope, sessionId)`, returning the five capture fields below after checking current GM authority; and `provider.transcribe(wavBytes, context)`, returning transcript text or throwing. The service clears its audio buffer after processing. Do not retain raw audio, forward it to an external provider, or retry a receipt-only completion as a new inference. The provider must enforce the original runtime fence before and after upload and fail closed when Obus authority is missing, expired, replaced or disabled. Local-only routing is a destination restriction, never a substitute for host authority.

Use `@operator/obus-chronicle-provider@0.1.1` with the distinct host/participant callbacks from `@operator/membership-client@0.1.1`. These are injected adapters, not package runtime dependencies. The participant callback never grants recording consent. The voice receiver and service independently require the saved session's capture grant and epoch. Full chronicles remain local-only even when optional Codex is enabled for eligible tasks elsewhere.

`makeVoice({client, config, store, service})` returns synchronously:

- `start(sessionId, hostId, {authorize} = {})`: an async capture attach operation. When supplied, recheck the async `authorize()` callback before and after voice readiness; abort and clean up on denial.
- `stop({flush} = {})`: detach capture and drain pending work as requested. Invalidate pending joins as well as an active capture.
- `revoke(userId)`: discard that user's in-flight capture immediately.
- `status()`: return a safe human-readable status.

Davy's adapter owns the existing voice connection. Chronicle stop, disconnect, and shutdown must not destroy the music player, shared voice connection, or Discord client. The package has no `discord.js` dependency. Its exported `createVoiceReceiver` uses the pinned voice and decoder dependencies with an injected connection lease; Davy retains connection ownership. A host may also inject its own compatible voice adapter.

At the first accepted audio byte, freeze the authorized campaign/session/speaker, one stable segment request ID, the then-current consent epoch and an already verified unexpired Obus runtime snapshot. Never resolve whichever session or generation happens to be current later. Feed a bounded WAV buffer through this exact service call:

```js
await service.speech(capturedSession, {
  user: capturedSpeaker, speaker: capturedDisplayName, bytes: wavBuffer,
  at: capturedTimestampMs, scene: capturedSceneSequence,
  captureEpoch: capturedConsentEpoch,
  context: {
    scope: { campaign: capturedCampaign, owner: capturedSpeaker, role: 'player' },
    session: capturedSession, requestId: stableSegmentId,
    capturedRuntime: {
      contract: 'raph-obus-game-runtime-v1', bootEpoch, generation,
      sessionPolicyRevision, leaseExpiresAtMs,
    },
    capturedConsentEpoch,
  },
  authorizeParticipant: async scope => currentCapturedDiscordAudienceStillAllows(scope),
});
```

The callback must verify the captured speaker still belongs to the captured Discord channel/session and authorized capture generation. It runs before upload and before commit, alongside the provider's current canonical game membership check. `speech` compares the saved session campaign and consent epoch, then makes a final host runtime check after asynchronous audience checks. A later grant cannot revive old consent, and a later host/policy revision cannot relabel buffered audio. The durable source is `voice:${requestId}`; the old arbitrary `source` field is no longer used. Missing context or authorization denies speech. The provider receives exactly the same context as its second `transcribe` argument. Capture-only `leaseExpiresAtMs` and `capturedConsentEpoch` are not serialized into the four-field Obus wire runtime fence.

This scoped speech contract is the migration from 0.1.0 to 0.1.1. The factory, returned runtime API, explicit dependencies, transport calls and shutdown ownership remain unchanged. Preserve the previously handed-off 0.1.0 tarball; do not replace its contents with this version.

`transport` supplies `respond(interactionId, token, payload)`, `edit(applicationId, token, payload)`, `followup(applicationId, token, payload)`, `member(userId)`, and `send(channelId, payload)`. These are methods over Davy's existing authenticated transport. `member` takes one user ID and fetches current guild membership. Honor payload privacy, `allowed_mentions`, and delivery nonce fields. `send` returns the actual Discord message `{id}`; attach a numeric HTTP `status` to confirmed rejection errors. An unknown send outcome is kept for review rather than automatically repeated.

If Davy already acknowledged an interaction, pass `{acknowledged:true}` so the chronicle edits the existing private reply. Otherwise it issues a private defer itself. Only pass matching `/session` interactions; `handle` returns false for unrelated commands. Do not forward a single interaction through both paths.

`authorizeCommand(scope)` checks current game membership when durable browser commands execute. The default denies queued host work. Discord membership and GM permissions are also checked by the dispatcher. Optional `images` may provide an existing approved image service; omitting it preserves text/manual operation. Safe `log` events contain outcomes rather than credentials or transcript contents.

## Summary continuity in 0.1.2

With the private store-backed Obus evidence bridge and provider 0.1.1, bounded interval summaries use `raph-obus-game-evidence-refs-v2`. Each selection binds its campaign, session, exact source versions, derived-source dependencies and current contributor consent before the first asynchronous authorization check. Obus must explicitly advertise that contract; an older backend causes a deferred/failed summary instead of a silent downgrade.

New messages can arrive while a summary runs. They remain in the next summary window. Corrections, deletion, visibility changes or relevant consent withdrawal invalidate the affected work. For multi-part summaries, the service captures every part's guard before generation and checks them all inside the final database transaction. Failure commits no summary and advances no watermark. Authorization and host runtime checks still apply separately.

The evidence worker can acknowledge a successfully synchronized unchanged prefix while newer messages remain due. It never labels an older receipt as the latest revision. Source hashes establish consistency, not permission; Obus still checks current access and external-processing consent. Full transcript and final-recap processing remain local-only. Preserve the 0.1.0 and 0.1.1 archives when installing 0.1.2.

## Durability boundaries

The queue uses leases, bounded retries and stored receipts. Committed start/pause/end effects are reconciled after restart without replaying global voice actions against a newer session. Voice attachment and provider calls can still be attempted again if a process stops before saving their receipt. The injected adapters must tolerate repeated attempts. Uncertain Discord sends remain paused for review to avoid duplicating a message accepted before a connection failed.

Session capture and external AI consent are separate. Runtime initialization, package import and opening a client do not grant either permission. A gateway gap pauses capture; resuming capture and rejoining voice remain explicit controls.

## Building and checking the artifact

From this package source directory:

```text
npm install --ignore-scripts
npm run build
npm test
npm run pack:artifact
```

The build emits one ESM bundle and local audit manifests. Its esbuild metafile is checked against an explicit 17-file source allowlist, including the scoped evidence selection helper, Davy composition and injected voice receiver. External imports must be Node built-ins or the three pinned runtime dependencies. Accidental imports of the Operator platform, standalone bot, web application or additional dependencies fail the build before output is written.

Tests check source and bundle hashes, the package payload, and installation into an isolated temporary consumer outside the Operator checkout. The installed package is exercised with controlled Obus/Discord/voice adapters, including pre-acknowledged private replies, consent, corrections, queue authorization, saved state and shutdown. These are fixture tests; live Discord audio, model inference, and mixed-account acceptance still require the configured host.

The tarball contains only `package.json`, this README, and `dist/index.mjs`. Local `dist/build-manifest.json`, `dist/metafile.json`, and `artifacts/manifest-0.1.2.json` retain build inputs, hashes and the exact package payload for review; they are not runtime dependencies. No database, audio, tokens, environment files or other project source is packed.
