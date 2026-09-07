# Shared chronicle implementation

Verified 2026-09-06. This is a source and fixture milestone in the full Obus/Discord game plan, not a live Discord release.

## Shared controls

`app/play/chronicle.tsx` is mounted once in the shared Play screen, including the Activity shell. It uses `client/api.mjs` and the same authenticated `app/api/game/chronicle/route.ts` endpoint on either surface. The API derives campaign, owner and role from current membership; it accepts no identity overrides.

Players can read the current transcript, set capture and external-processing permission independently, add notes during an active session and correct their own transcript. The GM can correct shared story entries and queue start, pause, resume, voice, leave, summary and end. A new start always sends a null session ID and revision zero; closing sessions cannot start another session. Transcript responses are bounded to 100 entries and contain current corrected/deleted projections.

The API rejects stale changes before creating work. Permission reductions are accepted despite a stale transcript revision so ongoing speech cannot prevent withdrawal. A delayed old enable request cannot undo a newer withdrawal. Replays reuse their original ID and immutable payload. Queued and immediate actions share the same request-ID namespace.

## Bot execution and persistence

- `chronicle/storage.mjs` opens the same per-campaign chronicle database for web requests and the bot. The default is `%LOCALAPPDATA%/Raphael/chronicle/<campaign>/chronicle.sqlite`, outside OneDrive. The existing environment override remains available.
- `chronicle/commands.mjs` persists bounded queued/running/done/failed jobs. Claims carry worker and lease tokens; long jobs renew their leases. A lost lease cannot overwrite another worker's result. Three expired attempts become a durable failed receipt.
- `chronicle/dispatch.mjs:createChronicleDispatcher` rechecks current GameStore membership, fresh Discord member roles, current campaign/session and source revision before an effect. A revoked actor cannot execute or recover a command merely because it was queued earlier.
- Start and control request IDs are mapped to durable effect receipts. Reclaiming an already committed old pause/end reconciles its receipt without calling global voice stop; a newer resume/session may own voice by then.
- The queue is at least once. A voice/summary task interrupted before its effect receipt can be attempted again. Summary source watermarks and final-recap caches prevent duplicate source commits, but this is not an exactly-once promise for an external effect.
- `discord/chronicle-core.mjs:createChronicleRuntimeCore` requires an injected Obus story provider, voice factory and dedicated chronicle store. It accepts the existing Discord client and never logs in. It polls commands independently of background Obus summaries, handles edits/deletions and disconnect gaps, and drains capture before storage closes. `discord/chronicle-runtime.mjs:createChronicleRuntime` is the Operator wrapper that supplies its existing defaults. `discord/bot.mjs` supplies the current GameStore authorization callback.
- Direct `/session` work fetches current Discord membership when it executes, including after waiting behind another command. When Davy has already deferred an interaction privately, `handle(rawInteraction, {acknowledged:true})` edits the existing reply; an unacknowledged interaction receives a private defer. Each interaction must be forwarded once.
- Runtime close takes ownership of the dedicated chronicle connection. Concurrent calls return the same closing promise and wait for the same drain. Cleanup continues after an initial stop failure. If the final stop cannot confirm capture detachment, the store remains open, close rejects, and a later close can retry while new work remains blocked. Handle cleanup failures before disposing of the host transport. Do not pass the shared GameStore connection.

The wrapper is composed in the Operator JavaScript bot source. The portable artifact below can be installed in Davy's existing gateway; complete command-handler wiring and actual shared voice/music composition remain release dependencies. The injected Davy voice adapter must detach only chronicle capture and preserve Davy's music player, connection and Discord client. Davy Jones's separately implemented optional `/play` launcher is browser-entry evidence only. Do not start a competing gateway for the same bot identity.

## Coherent portable packages

Source entry: `packages/chronicle/index.mjs`. Chronicle 0.1.1 retains `createChronicleRuntimeCore` and its `createChronicleRuntime` alias, `ChronicleStore`, `ChronicleCommands`, their errors and `SESSION_COMMAND`. Its factory, returned runtime API, pre-acknowledged replies and shutdown ownership are unchanged. The version change requires captured scope and fresh authority in `service.speech`; the old audio-only consumer is not compatible.

| Package and artifact | Bytes | SHA256 |
|---|---:|---|
| [@operator/chronicle 0.1.1](packages/chronicle/artifacts/operator-chronicle-0.1.1.tgz) | 23,907 | `78c8b0748b2ed19bf21741db7b36b805c205f5dd1a056bf3cd3adf1391552575` |
| [@operator/obus-chronicle-provider 0.1.0](packages/obus-provider/artifacts/operator-obus-chronicle-provider-0.1.0.tgz) | 8,757 | `4f038207f8550a3ca3413bf703af871b4dbfe6378360103ce79fe6c1fc1621f6` |
| [@operator/membership-client 0.1.1](packages/membership-client/artifacts/operator-membership-client-0.1.1.tgz) | 3,268 | `61e56518d989747f8d0cfde2c3c4d831e27fc1953e666a1a27e3073439233ed0` |

All artifact paths above are relative to `C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons/raphael-council`. Install this version set together and inject dependencies from Davy's existing composition root. The previous Chronicle 0.1.0 remains immutable at hash `5b7f032a1ddedbc9f30ac65a256f319a985059860250b96de192b20327c375c6`; do not replace it with new contents. New pack scripts refuse existing tarball overwrite.

[Chronicle instructions](packages/chronicle/README.md), [provider instructions](packages/obus-provider/README.md), [Chronicle manifest](packages/chronicle/artifacts/manifest-0.1.1.json) and [provider manifest](packages/obus-provider/artifacts/manifest-0.1.0.json) record the handoff. Both require Node `>=22.16.0`; Chronicle requires `@napi-rs/canvas@1.0.8`, while the provider has no runtime package dependencies. The build dependency is `esbuild@0.27.3`. Chronicle's bundle is 71,058 bytes at SHA256 `fb5b27a14feac00b8fc014631b16d1924a9bce72bdee9c71127b225a261531d8`; the provider bundle is 22,461 bytes at SHA256 `2568cb108e40374a1f676226006f9c9b2dcd050528c6ce4497aa10f57f8805a6`.

Chronicle's build admits exactly eight source modules plus Node built-ins/native canvas; it imports no default voice receiver, platform or standalone bot. The provider admits only its entry, `ai/obus.mjs` and `chronicle/obus-provider.mjs`, with Node built-ins externally. It exports `ObusTransport` and `createObusChronicleProvider`, not GameAi, GameStore, auth/runtime or a host signer. Each tarball contains only its README, package manifest and ESM bundle. No secret, transcript database or audio is packed.

```js
import { ObusTransport, createObusChronicleProvider } from '@operator/obus-chronicle-provider';
import { createMembershipClient } from '@operator/membership-client';
const membership = createMembershipClient({ url: privateMembershipUrl, token: membershipToken });
const provider = createObusChronicleProvider({
  campaigns: [configuredCampaign],
  transport: new ObusTransport({ url: privateObusUrl, serviceToken: obusServiceToken }),
  authorizeCommand: membership.authorizeCommand,
  authorizeParticipant: membership.authorizeParticipant,
  onReceipt: recordPrivateProvenance,
});
```

The membership bridge remains a canonical game authorization boundary, not an AI router. Host-only `authorizeCommand` is separate from `authorizeParticipant`. The latter never grants capture or external-processing consent. Davy receives service/bridge credentials only; the host-control signing key stays with the game host. Inject this provider and the existing shared capture factory into `createChronicleRuntime`. Package installation does not establish a lease, activate Davy, register commands or release the separate live-activation hold.

## Bounded delivery and uncertain outcomes

Confirmed delivery failures back off for 60, 120, 240 and 480 seconds, then stop after the fifth failed attempt. Attempt state survives restart. The GM can use Retry delivery in the shared panel or `/session retry-delivery`, including for the latest ended session. Retry receipts are idempotent and preserve confirmed multipart message receipts. One failed delivery does not starve later entries.

Before each external send, the bot persists an uncertainty marker. It clears that marker atomically with the confirmed part receipt. A timeout, missing response ID, receipt-save failure, or process crash after dispatch leaves the outcome uncertain. Such entries stay paused across restart and ordinary GM retry. The panel displays that Discord review is needed; it does not offer another send for an uncertain-only queue. A future reconciliation workflow must verify the original message or confirm it was not sent before resolving this state. Discord nonce support is not treated as an indefinite exactly-once guarantee.

`chronicle/delivery-retry.test.mjs` verifies eight cases covering capped retries, partial receipts, starvation, and uncertainty before/after external acceptance. The real HTTP/dispatcher suite also verifies GM-only recovery in active, paused, ending and ended sessions. Corrected/deleted projections are recomputed when a delivery is retried.

## Consent, correction and voice boundaries

`ChronicleStore.privacy` stores independent capture and external permission plus change epochs. Audio captures the permission epoch before asynchronous membership/STT work. Withdrawal followed by re-enablement still discards the earlier segment. Raw buffers are cleared after completion, rejection and queue overflow.

`chronicle/voice.mjs` fences asynchronous connection attempts with a generation counter. Stop, pause, another join or shutdown cancels an older pending join. Fresh host permission and the internal game/lease authorization callback are checked before and after connection readiness. Thrown authorization checks count as denial and clean up the connection.

Discord consent commands bypass slow summary work. Replaying a previous consent interaction does not write its old permission again. Both surfaces share the same database settings.

## Scoped speech contract

The provider offers `authorizeParticipant(scope)` and host-authorized `captureRuntime(hostScope, sessionId)`, in addition to `write` and `transcribe`. Capture runtime returns frozen `{contract,bootEpoch,generation,sessionPolicyRevision,leaseExpiresAtMs}` after current GM authorization and a valid Obus runtime lookup. Every retained segment binds its captured campaign/session/speaker, one stable request ID and consent epoch at its first accepted audio byte. Do not look up a different current session later. Standalone voice discards bytes received before current participant/host authority is verified, recording an explicit gap. It refreshes runtime only for future segments and stops capture after a host boot/generation replacement.

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

The voice callback checks the captured speaker's current Discord channel/session and capture generation. `ChronicleService.speech` independently compares the saved session campaign, speaker and consent epoch; checks canonical game membership and voice audience before upload and before commit; then compares a fresh host runtime snapshot after those asynchronous checks. A late generation/policy change discards the result. Missing context or authority denies speech. The durable source is `voice:${requestId}`; arbitrary caller `source` is no longer used.

`provider.transcribe(wavBuffer, context)` receives that same frozen context as its second argument. The WAV limit is 6,000,000 bytes. The transport uses fresh runtime GETs to validate the original boot/generation/policy revision and a currently enabled, unexpired lease. Renewal may extend expiry; it may not rebind a segment. The exact `/api/voice/transcribe` wire body is `{contract:'raph-obus-game-stt-v1',scope,session,requestId,runtime:{contract,bootEpoch,generation,sessionPolicyRevision},audio_base64,mime_type:'audio/wav'}`. Capture-only `leaseExpiresAtMs` and `capturedConsentEpoch` are omitted from the wire. Audio-only calls are unsupported.

A completed transcript returns text; `completed_receipt_only` fails without rerunning inference or inventing a transcript. Record a gap/deferred result. Retries retain the original ID, context and audio identity. Raw bytes are cleared on completion, denial and overflow. Obus's service token and typed role are not proof of Discord membership or consent; the game/voice adapters enforce those separately. No raw audio is archived or sent to free providers/Codex.

`ChronicleStore.sharedEntries` applies current corrections and deletion tombstones to the HTTP view, pending Discord delivery and portable report. Source corrections invalidate earlier summaries. The local authoritative audit is retained; deleted transcript text is not restored by another correction. Pending summarization rechecks corrections and session state before committing.

All AI and speech calls still go through Obus. Full transcript summaries and final recaps remain local, even when external permission is stored. Permission is not an instruction to export an unrestricted transcript. Bounded opted-in excerpt export and campaign-to-Obus source synchronization remain separate implementation work.

## Evidence

The earlier combined project run passed 465 Node tests. After adding delivery recovery, the covering chronicle/Discord/client/status run passed 214 tests, targeted ESLint and the production build; TypeScript also passed during the UI update. These historical milestones remain distinct from the latest portable-core checks.

The earlier portable-core/pre-acknowledgement/current-role/shutdown milestone passed 223/223 covering tests. Scoped voice source subsequently passed 101 chronicle checks; after three more default-provider cases, the focused speech-scope suite passed 9/9. The isolated voice wrappers verify that all eight lifecycle and eight capture fixtures actually execute. AI status/recovery migration passed 7/7 with explicit membership and Obus runtime state.

The exact current tarballs were hash-verified and installed outside the Operator checkout using `OPERATOR_VERIFY_ARTIFACT=1`: Chronicle passed 3/3 package checks plus 11 runtime fixtures; the provider passed 3/3 package checks plus 10 actual-transport fixtures. The latter includes the two packages co-installed and running real `service.speech` through the actual provider and ObusTransport with controlled fetch responses. They cover scoped wire fields, consent revocation, membership denial, stale fences, renewal, receipt-only results and no alternative routing. Package ESLint passed. Overwrite refusal was exercised and the old Chronicle 0.1.0 hash stayed unchanged. These checks do not constitute a new web build, live Obus inference or real Discord test.

Focused suites include:

- `chronicle/http.test.mjs`: real HTTP handlers, controlled authentication, persisted queue, cross-surface authorization, stale consent behavior, correction ownership, restart receipts, and an ended-to-second-session flow through the actual dispatcher.
- `chronicle/commands.test.mjs`: two database connections, restart, replay fingerprints, lease fencing, bounded attempts/capacity and outer transaction rollback.
- `chronicle/dispatch.test.mjs`: fresh role checks, source revision checks, renewal, stale worker publication, committed-effect recovery and shutdown.
- `chronicle/privacy.test.mjs`, `chronicle/projection.test.mjs` and `chronicle/consent-adapter.test.mjs`: consent races, source changes during generation, obsolete delivery/report content and Discord consent responsiveness.
- `chronicle/voice-start.test.mjs`: an isolated subprocess runs eight mocked Discord lifecycle fixtures; the wrapper verifies all eight executed. `chronicle/voice-capture.test.mjs` separately verifies eight receiver/decoder cases for first-byte capture binding, authority gaps, changed generations, withdrawal/regrant and draining. These prove fixture behavior, not microphone accuracy or actual Davy transport compatibility.
- `chronicle/speech-scope.test.mjs` and `chronicle/obus-provider.test.mjs`: frozen context, separate host/participant checks, late membership/audience/generation changes and receipt-only behavior.
- `client/chronicle.test.mjs`: actual component handlers in a hook fixture, including immutable retries, revoked-access cleanup, second-session payloads and API-aligned controls. This is not a real browser/Discord iframe test.

Gortex's Git-based detection cannot see the untracked project sources. Explicit symbol checks, mutation receipts and executable tests were used. Its broad contract risk warning reflects the shared lifecycle surface; the indicated covering suites passed. No live bot command publication, live data migration, public tunnel or private-agent restart occurred in this slice.

## Remaining gates

Finish wiring the artifact into Davy's complete existing handler and shared music/voice lifecycle, including pre-acknowledged private errors, current-member checks, disconnect and shutdown. The packaged fixtures use injected adapters; live Davy capture and transport behavior remain unverified here. Add reviewed reconciliation for uncertain external sends and the remaining scene/read-aloud/report UI workflows; configure and benchmark actual local STT; synchronize authorized campaign evidence into Obus; test real Davy audio and browser/Activity clients with a GM and two players.

Packaging enables no backend capability. The current shared-master stage is strict-local, export-disabled and Codex-off; `codex:true` is rejected. Local plus free providers is the intended future default, not present readiness. The backend owner reports 26 focused HMAC/CAS/STT fence checks, while the newest private capability probe returned HTTP 200 with local STT `route_ready:false`; game-host generation verification remains pending. Earlier model provisioning and synthetic speech evidence do not prove current end-to-end capture. Free routes, Codex-on operation, semantic RAG performance and fresh local inference remain release gates.

GameAi now reads Obus runtimeState and uses asynchronous policy/configure, without legacy `ai_policy` or a local boot authority. AI PATCH requires request identity and expected boot/generation/policy-revision fields. Client UI payload migration is still owned separately; integrated live GM controls are not claimed. The new `host/cli.mjs` and `host/ai-services.mjs` compose read-only scope discovery and an existing private Obus lease lifecycle; build opens no private services, while invalid dev/start configuration leaves manual mode. Root reports 15 focused host checks, 111 combined host checks and TypeScript passing. Read-only `node host/diagnostics.mjs` adds seven passing checks and lint without reading the host signer or changing authority/data. The latest actual diagnostic reports valid reachable Obus, free/Codex/STT unavailable, metadata unavailable, no discovered sessions and inference not run. A separate generation preflight found a missing default private host-control token, now assigned to the Obus owner for dedicated game-only configuration. Actual activation, complete supervision and the GM-plus-two-player mixed-interface mission with a controlled restart remain open.

Full chronicle summaries stay local; stored external consent never enables unrestricted transcript export. See [the architecture status](OBUS_INTEGRATION.md) for current source versus runtime evidence.

A chronicle migration backup is not a full campaign recovery checkpoint. Coordinated recovery must include the game, character approvals, image store/assets, chronicle and required campaign assets at one quiesced cut. Validate pinned character revisions and image publication compatibility before staging an all-or-nothing restore. Do not treat independent database backups as coherent campaign recovery.

The overall architecture and remaining six-phase work are tracked in [OBUS_INTEGRATION.md](OBUS_INTEGRATION.md).
