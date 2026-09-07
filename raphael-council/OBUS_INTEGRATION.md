# Obus is the main backend agent

Status: implementation in progress, evidence updated 2026-09-06. The full six-phase release plan is not yet complete. Current runtime work is a strict-local, export-disabled, Codex-off stage. Local plus free providers remains the intended future default, not a claim of present provider readiness.

## Architecture decision

All generative model and speech requests from Raphael go through the private Obus game agent. Obus owns model selection, fallback, local repair attempts, retrieval and provider credentials. The game supplies authenticated scope, authorized evidence, task limits and host policy. The deterministic engine owns rolls, rules, permissions and saved state.

Do not add a direct Ollama, OpenAI, Codex CLI or other model call in the game. Do not fall back to the generic Obus `/api/route/run`: disabling retrieval there does not prove personal-memory isolation or prevent automatic general-memory retention.

## Implemented and verified

- `ai/obus.mjs`: authenticated loopback-only client for the `raph-obus-game-v1` contract, capability checks before sending evidence, bounded responses and executed-route validation. Missing capabilities fail closed.
- `ai/service.mjs`: current game membership, bounded jobs and persistent game-facing receipts. Obus owns routing, scheduling, runtime policy and dispatch receipts. `GameAi` reads fresh `transport.runtimeState(scope, session)`; `policy` and `configure` are asynchronous. It never reads legacy `ai_policy` rows or uses a private local boot ID as policy authority. Status requires authenticated scope. Missing, expired, replaced or disabled host authority must deny every inference, including local speech; local-only is a destination restriction, not authority.
- Obus checkout `C:/Users/Hermes/Documents/obus-moa-exe/backend/game_agent.py`: private service at `127.0.0.1:38175`, using the existing Obus catalogue and provider helpers. It has no generic agent tools, personal-memory lookup or automatic global-memory writing. It keeps campaign sources and job receipts in its own local database.
- The current shared-master runtime stage permits strict local processing only, with export off and Codex off. `codex:true` is rejected; neither a login nor advertised routing support enables it. Earlier source work includes bounded local repair, scoped lexical retrieval, revisioned sources and rejection of opaque/unknown-cost routes. Free-provider activation, semantic RAG performance and tool-free Codex escalation remain separate gates.
- Game image generation also goes only to Obus. With no advertised local image route it reports unavailable; approved artwork and deterministic tactical maps remain available.
- Browser `/play` and Discord `/activity` use shared screens, authentication and game handlers. The root page selects the Activity shell when Discord supplies SDK frame parameters. Those parameters grant no permissions.
- `client/api.mjs` selects browser `/api/...` or Activity `/.proxy/api/...` paths. Shared requests, map downloads and image URLs use it. Activity cookies cover proxied paths and use Secure, HttpOnly, SameSite=None and Partitioned attributes.
- `discord/chronicle-core.mjs:createChronicleRuntimeCore` composes an explicitly supplied Obus provider, voice factory and dedicated chronicle store with an existing Discord client. `discord/chronicle-runtime.mjs` retains the Operator defaults as a wrapper. The portable `@operator/chronicle` entry exports the core without importing the Operator platform, default voice receiver or standalone bot. `discord/bot.mjs` retains its other handlers and adds launch/session handling, opted-in message capture, voice intents when enabled, workers, reconnect gaps and shutdown draining.
- The runtime accepts `handle(interaction, {acknowledged:true})` after Davy has deferred privately; it edits that reply without a second acknowledgement. Direct commands recheck current Discord membership when their work executes. Concurrent closes join one drain. Failed cleanup is surfaced; the store remains open if capture detachment cannot be confirmed, and a later close can retry while new work stays blocked. Davy must retain ownership of its shared voice/music connection and transport.
- `/raphael activity` uses the Activity launch callback; `/raphael web` links to the public game origin without access tokens. Explicit command registration uses individual upserts and refuses unrelated name collisions.
- Shared chronicle API and panel now work in `/play` and `/activity`: bounded current transcripts, separate capture/external consent, notes/corrections, GM start/pause/resume/voice/leave/summary/end controls, safe retry IDs and queued/completed results. A completed session can start a new one through the real HTTP and bot dispatcher contract.
- Browser voice controls persist in `chronicle/commands.mjs`; `chronicle/dispatch.mjs` rechecks current game membership, Discord roles and session revision, renews leases, fences stale workers and reconciles committed effects without stopping a newer session's voice. Queue execution is at least once; it is not an exactly-once guarantee for a voice/summary operation interrupted before its receipt.
- Chronicle tests cover account-based speaker attribution, opt-in capture, withdrawal/re-enable during transcription, clearing raw buffers, typed edits/deletions, restart gaps, delayed voice-join cancellation, final voice draining and local-only story prompts. Consent withdrawal bypasses slow Discord summary work. Corrections invalidate stale summaries; deleted text is masked in current API projections, pending Discord deliveries and portable reports while the authoritative local audit is retained.
- Existing chronicle databases receive a SQLite backup before new privacy/receipt tables are created. This is a schema-migration backup, not a coordinated backup of the entire campaign. See [chronicle implementation details](CHRONICLE_INTEGRATION.md).

## Coherent portable Davy artifacts

Use the following versions together; the membership and Obus providers are explicitly injected, not hidden sibling-checkout imports.

| Package and artifact | Bytes | SHA256 |
|---|---:|---|
| [@operator/chronicle 0.1.1](packages/chronicle/artifacts/operator-chronicle-0.1.1.tgz) | 23,907 | `78c8b0748b2ed19bf21741db7b36b805c205f5dd1a056bf3cd3adf1391552575` |
| [@operator/obus-chronicle-provider 0.1.0](packages/obus-provider/artifacts/operator-obus-chronicle-provider-0.1.0.tgz) | 8,757 | `4f038207f8550a3ca3413bf703af871b4dbfe6378360103ce79fe6c1fc1621f6` |
| [@operator/membership-client 0.1.1](packages/membership-client/artifacts/operator-membership-client-0.1.1.tgz) | 3,268 | `61e56518d989747f8d0cfde2c3c4d831e27fc1953e666a1a27e3073439233ed0` |

The previous Chronicle 0.1.0 tarball is preserved at SHA256 `5b7f032a1ddedbc9f30ac65a256f319a985059860250b96de192b20327c375c6`; it is not the scoped speech consumer. Both new artifact writers refuse an existing tarball overwrite. [Chronicle manifest](packages/chronicle/artifacts/manifest-0.1.1.json) and [provider manifest](packages/obus-provider/artifacts/manifest-0.1.0.json) record exact payloads. Both packages contain only their manifest, README and ESM bundle. Node must be `>=22.16.0`; Chronicle depends on `@napi-rs/canvas@1.0.8`, while the provider has no runtime package dependencies. The build dependency is `esbuild@0.27.3`.

Chronicle admits exactly eight source modules and only Node built-ins plus native canvas externally. The provider admits exactly its entry, `ai/obus.mjs` and `chronicle/obus-provider.mjs`, with only Node built-ins. It excludes GameAi, GameStore, auth/runtime, default voice/provider, host signer and bot startup. See the [Chronicle README](packages/chronicle/README.md) and [provider README](packages/obus-provider/README.md).

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

`authorizeCommand` remains host-only; `authorizeParticipant` checks current canonical game membership and never grants recording consent. Obus, membership and host-control credentials are separate. Davy receives no host-control signing key. The provider exposes host-authorized `captureRuntime`, participant authorization and `transcribe(bytes, capturedContext)`; audio-only calls are unsupported. [The scoped speech handoff](CHRONICLE_INTEGRATION.md#scoped-speech-contract) preserves captured speaker/session, consent epoch and runtime fence. Local-only narration and speech still fail when shared host authority is absent or disabled.

Exact final tarballs were hash-verified and installed outside this checkout: Chronicle passed 3/3 package checks plus 11 runtime fixtures; the provider passed 3/3 package checks plus 10 actual-transport fixtures, including the two packages co-installed through real `service.speech`. These controlled responses prove consumer compatibility, not live Discord or Obus readiness. Packaging does not release the separate activation hold, register commands, enable recording or establish a game-host generation.

## Historical local inference evidence

A synthetic game narration request completed through the game adapter and the private Obus game agent:

- Model: `obus-qwen3.8-27b:65k`
- Route: `7d0c18a4-18d0-415b-be36-bfde4d6d3d37`
- Executed destination: local, registered Obus provider `key-local-ollama`
- Duration: 10,952 ms
- Response: “The harbor bell rings as Maren enters the tavern.”

Only synthetic scene facts were used. This historical request predates the current shared-master host-generation enforcement and must not be presented as proof that the new lifecycle is active. Fresh inference through a current authenticated game-host generation, real Discord speech, eligible external routes and complete RAG synchronization remain to be verified.

## Host commands

From `raphael-council` in PowerShell:

```powershell
.\scripts\obus-game.ps1 -Action start
.\scripts\obus-game.ps1 -Action status
.\scripts\obus-game.ps1 -Action stop
```

The launcher reuses a healthy game agent and records process identity before managing a new one. Stop only targets a matching managed process. Earlier start/reuse/status/stop/restart checks are historical process-management evidence, not current game-host authority. The newest private `38175` capability probe returned HTTP 200, but local STT advertises `route_ready:false`, free/Codex routes remain disabled, and generation verification is pending. A healthy listener alone does not authorize inference.

Obus itself must be healthy first. The default core address is `127.0.0.1:38173`; the isolated game service uses `38175`. Its service token is generated locally in `~/.occultbus/game-agent/service-token`. Neither token nor provider credentials are sent to the browser. Set `RAPHAEL_OBUS_URL` or `RAPHAEL_OBUS_TOKEN_FILE` only for an intentional local configuration change.

A separate explicit source entry now exists for composing the web host with the game-host lease lifecycle:

```text
node host/cli.mjs build [web options]
node host/cli.mjs dev [web options]
node host/cli.mjs start [web options]
```

`host/ai-services.mjs` composes read-only campaign/session scope discovery with the existing private Obus lifecycle. Build opens no private services. Dev/start attempts the lease lifecycle; missing or invalid configuration leaves manual game mode usable. It requires the canonical `RAPHAEL_MEMBERSHIP_CAMPAIGNS` allowlist, existing stores outside OneDrive and private Obus configuration. These source commands do not launch Obus or Davy, write the membership bridge, migrate stores or create a tunnel. `images/host.mjs` remains a separately owned entry. Root reports 15 focused host checks, 111 combined host checks and TypeScript passing; actual activation and a verified generation remain open.

Read-only diagnostics are available as `node host/diagnostics.mjs`. This command reads no host signer and changes no authority or database. Seven diagnostic checks and targeted lint passed. Its latest actual result reports Obus reachable with a valid contract, `freeRoutes:false`, `codexAvailable:false`, `localSttReady:false`, `metadata:unavailable`, `sessions:[]` and `inference:not-run`. A separate generation preflight found the default private host-control token missing; the Obus owner is resolving dedicated game-only signer configuration. No live generation verification is claimed.

The game-host generation must be fresh on each actual game-host start, even when the Obus process is reused. Host-control HMAC/CAS calls establish and renew that lease; loss or replacement fences old work and defaults Codex off. HTTP AI PATCH now requires `requestId`, `expectedBootEpoch`, `expectedGeneration` and `expectedSessionPolicyRevision` alongside the session/settings. Clients must await asynchronous policy/configure results and refresh after a stale revision. The current UI payload migration remains with its owner; these API changes are not proof of integrated live GM controls.

Use the existing Davy Jones application credentials in `.env.local`; do not register a replacement application. Set the OAuth client ID/secret, guild/campaign membership and `RAPHAEL_PUBLIC_ORIGIN`. Browser OAuth redirect: `<public-origin>/api/auth/discord/callback`.

After enabling the required Discord Message Content intent and voice permissions, set `RAPHAEL_CHRONICLE_ENABLED=1`. Capture still requires `/session start` and each participant's `/session consent enabled:true`. Story-channel and chronicle storage overrides are in `.env.example`. Existing installations retain Guilds-only behavior until this setting is enabled.

Register the added commands only when the existing application is configured:

```powershell
npm run bot -- --register
```

This command connects to Discord and updates the two owned command definitions; it has not been run against the live application. Run one gateway for the bot identity. If another Davy Jones gateway already owns it, compose or bridge that gateway before starting `npm run bot`; do not run competing copies. The exported chronicle runtime itself never creates or logs in another Discord client.

Expose only the game web/API host through HTTPS. Configure Discord's root URL mapping `/` to that public game host, preserving `/api` and asset paths. Do not map the root to a target with `/activity` appended. The root shell handles the Activity launch. Actual Discord proxy/iframe behavior remains a live acceptance check. See [Discord networking](https://docs.discord.com/developers/activities/development-guides/networking) and [Activity launch callbacks](https://docs.discord.com/developers/activities/how-activities-work).

## Fresh checks

- Earlier broad baseline: 465 Node tests passed across client, AI, auth, chronicle, game, maps, characters, Discord, images and training. One outer test additionally executes eight isolated voice lifecycle fixtures; these use mocked Discord transport, not real audio.
- Historical Obus milestones included six backend checks and a later nine-check source run. The backend owner now reports 26 focused shared-master/child checks covering HMAC, CAS and STT lifecycle fences. This is strict-local/export-off/Codex-off source evidence; it does not establish current generation activation or a new successful live inference.
- TypeScript and targeted ESLint passed.
- After delivery recovery was added, the covering chronicle/Discord/client/status run passed 214 tests. Production `npm run build:game` and targeted ESLint passed at that milestone.
- After the portable core, private pre-acknowledgement, current-role checks and shutdown changes, an earlier covering run passed 223/223 tests: `chronicle/*.test.mjs`, `discord/*.test.mjs`, `client/chronicle.test.mjs`, and `ai/status.test.mjs`.
- Current portable verification passed 3/3 Chronicle package checks with 11 installed runtime fixtures, and 3/3 provider package checks with 10 installed transport fixtures. Exact final tarballs were hash-verified, installed outside this checkout and tested together through the real speech service. Artifact overwrite refusals were exercised; the old 0.1.0 archive remained unchanged. Package ESLint passed. No web build, live gateway or model inference is inferred from these checks.
- Scoped voice source verification passed 101 chronicle checks, including wrappers proving eight lifecycle and eight capture fixtures executed; the subsequent speech-scope suite passed 9/9 after three additional default-provider cases. AI status/recovery fixture migration passed 7/7 with explicit current membership and Obus runtime authority.
- `auth/interchangeable.test.mjs` uses real `DiscordAuth`, `authHttp`, `GameStore` and game handlers with a controlled Discord transport: two players, both login modes, interface switching, identical receipt replay, stale rejection, ownership rejection and membership revocation.
- `client/api.test.mjs` validates proxy paths, request preservation and cookie paths. It simulates proxy forwarding and does not claim a live Discord browser run.

Gortex cannot produce a normal tracked diff for the project because its source files are currently untracked. Covering tests and mutation receipts were used; this is not evidence of zero changes. No commit, public tunnel, live Discord command publication or paid model request was performed.

## Remaining implementation and live gates

1. Verify an active shared-master game-host generation, then activate only reviewed capabilities. The current stage is strict-local/export-off/Codex-off; free providers and tool-free Codex escalation remain unavailable. Earlier conditional-free source support does not prove an eligible configured route. Status separates free-route support from actual readiness. `escalationEligible:true` is task metadata; unsupported `codex:true` is rejected before dispatch. Coordinate with the existing Obus owner and preserve one routing authority.
2. Complete local STT activation and benchmark on this PC under the scoped runtime fence. Dependencies and a tiny local model have been provisioned in earlier backend work, with synthetic internal evidence, but the newest capability snapshot still advertises `route_ready:false`. Audio-only compatibility has been removed. Real Davy audio, current generation enforcement, consent withdrawal and actual throughput/accuracy remain acceptance gates.
3. Finish reviewed reconciliation for uncertain Discord sends, additional scene/read-aloud/report UI controls, and bounded opted-in excerpt export. Confirmed delivery failures now have five persisted attempts with backoff and shared GM retry controls. Uncertain external outcomes stay paused across restart and ordinary retry; confirmed message-part receipts are preserved. The shared API, browser command queue, transcript/correction controls and separate consent settings are implemented. Full chronicle summaries and recaps remain local through Obus, even when external permission is stored.
4. Finish campaign-database-to-Obus source synchronization, summary invalidation and local embedding benchmarks. Current retrieval is scoped lexical retrieval; semantic RAG is not enabled. Post-session edits/deletions and report rebuilding still need a defined workflow.
5. Complete council/advisor AI orchestration inside Obus, then connect deterministic council/counsel records to it without changing votes or rules authority. Existing deterministic council/counsel features remain usable.
6. Finish the remaining tactical/world roadmap, coherent backup/restore and complete host supervision. The new host entry/lifecycle fixtures do not prove release supervision. Recovery must cover game, approved characters, chronicle, image records and required assets at one coordinated checkpoint, with all-or-nothing restore validation. Existing mechanics are not a claim of full 2024 rules support.
7. Bind the portable package into Davy Jones's complete existing command handler and shared voice/music ownership, then prove the actual existing gateway composition. An optional launcher or isolated injected adapter does not establish that full integration. Verify Activity/OAuth configuration, a GM plus two-player mixed-interface mission, restart recovery, local/free/Codex modes and all-AI-unavailable mode. Approved campaign/character material and participating accounts are still required for that release gate.

No live stores were migrated by this integration run. New service data is outside OneDrive. Back up all authoritative stores before any live migration or import.
