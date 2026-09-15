# Davy host composition

`createDavyChronicleHost` composes the Chronicle runtime with explicit Discord transport, Obus game transport, signed host control, ChronicleStore, GameStore, and a shared voice factory. Module import does not open a database, inspect credentials, connect to Discord, or start model inference. It does not import Next or the application singleton.

The caller must supply matching `config.discordBindings` from the exported `discordCampaignBindings(env)` helper. These are the same bindings used by web/Activity authentication. Every fresh Discord member lookup is restricted by both current GameStore membership and the shared Discord policy. A saved player cannot become GM through Discord administrator rights. Removing a configured GM role revokes a saved host unless another configured host grant remains valid. Provider and voice authorization use the same checks.

`makeVoice` receives `{client,config,store,service,authorizeParticipant,captureRuntime}`. Davy supplies its existing `DiscordVoicePlayer` through `createChronicleVoice`; the portable `createVoiceReceiver` never owns the music connection. `runtime.stopCapture()` seals future capture starts and flushes capture before normal lifecycle draining. `runtime.close()` owns ChronicleStore cleanup; the outer host closes GameStore only after it succeeds.

## Production configuration contract

The configuration hardening below is integrated into Davy's actual `src/discord/chronicle-config.js`; all 14 configuration fixtures pass. The earlier `pending-davy-config.patch` is superseded historical evidence and must not be applied. Portable composition and isolated package tests pass independently; live Discord capture and host release acceptance remain separate checks.

The Davy configuration loader is opt-in. `RAPHAEL_CHRONICLE_ENABLED` absent, `false`, or `0` leaves the existing bot startup unchanged. Enabling it requires these explicit settings; no live values are supplied by this document.

| Setting | Required value |
| --- | --- |
| `RAPHAEL_CHRONICLE_RUNTIME_ROOT` | Absolute Operator `raphael-council` directory containing both built Chronicle/Obus packages and the game/host-control modules |
| `RAPHAEL_GAME_DATA_DIR` | Existing authoritative shared game directory containing `game.sqlite` |
| `RAPHAEL_CHRONICLE_DB_FILE` | Existing dedicated Chronicle SQLite file, with its `sessions` identity table |
| `RAPHAEL_CHRONICLE_DATA_DIR` | Existing directory for reports and required Chronicle files |
| `RAPHAEL_CHRONICLE_CAMPAIGN_ID` | Existing campaign ID; it must match `RAPHAEL_CAMPAIGN_ID` |
| `RAPHAEL_CHRONICLE_GUILD_ID` | Discord guild ID; it must match `RAPHAEL_GUILD_ID` |
| `RAPHAEL_CHRONICLE_CHANNEL_ID` | Session command and typed capture channel ID |
| `RAPHAEL_CHRONICLE_JOURNAL_CHANNEL_ID` | Transcript and recap destination channel ID |
| `RAPHAEL_CHRONICLE_APPLICATION_ID` | Existing Davy application ID; an explicit factory argument takes precedence |
| `RAPHAEL_DM_IDS`, `RAPHAEL_DM_ROLE_ID` | The same explicit host bindings as the web/Activity host |
| `RAPHAEL_PLAYER_IDS`, `RAPHAEL_PLAYER_ROLE_ID` | The same explicit player bindings as the web/Activity host |
| `RAPHAEL_OBUS_URL` | Private Obus game endpoint; defaults to `http://127.0.0.1:38175` |
| `RAPHAEL_OBUS_TOKEN_FILE` | Explicit private service token file, or use `RAPHAEL_OBUS_GAME_TOKEN`, never both |
| `RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE` | Explicit private signing key file, or use `RAPHAEL_OBUS_HOST_CONTROL_TOKEN`, never both |

All runtime, data, report, and credential file paths must be absolute local paths outside OneDrive. Symlink targets are checked as well. Existing databases are inspected read-only before writable construction. Setup never creates an empty replacement campaign. ChronicleStore retains its backup-before-schema-migration behavior.

Credential files are read only when the selected Obus operation runs. No general Obus credentials or provider administration are imported. Signed evidence synchronization and generation use only the private game interfaces. The existing host supervisor must establish and renew a valid Obus game runtime lease; this loader does not grant AI authority, enable external routes, or enable Codex. If Obus is unavailable, manual notes and deterministic session controls remain usable. Automatic images remain off without an explicit image adapter.

Call `createConfiguredChronicleRuntime({client,voicePlayer,logger,env,applicationId})` before mounting the gateway lifecycle. A configured result supplies `{runtime,registerCommands,configured:true,status:'ready'}`. Call `registerCommands()` only after the existing Discord client is authenticated. Registration checks current guild commands and refuses unrelated `/session` collisions before individually upserting the known Chronicle definition; it never replaces the guild command collection. The runtime does not call Discord login or destroy the client.

## Build and verification

Davy's configured loader imports `packages/chronicle/dist/index.mjs` and `packages/obus-provider/dist/index.mjs` from the explicit runtime root. It no longer imports the loose `ai/obus.mjs` transport. The verified release pair is Chronicle 0.1.2 and Obus provider 0.1.1; retain their previous immutable archives for rollback. The host still needs the same root's `game/store.mjs` and `ai/host-control.mjs`, so merely copying tarballs beside Davy is not a configured runtime.

From the Operator app directory run `node packages/chronicle/build.mjs` and `node packages/obus-provider/build.mjs`. Run `npm test` from each package directory. With `OPERATOR_VERIFY_ARTIFACT=1`, the package fixtures install the exact versioned archives. The audited bundles allow only their explicit source sets and pinned dependencies.

The lazy `hostControl.syncEvidence(input, assertCurrent)` adapter forwards the bridge's synchronous consent/source guard to the real signer. It must run after credential initialization and before/after each signed upload request. A withdrawal during paging stops further pages and prevents commit; an unchanged captured prefix may complete while new messages remain for the next synchronization. Do not replace this with a one-argument wrapper or a check only after the complete upload.

For the cross-checkout configured-host test, set `DAVY_CHRONICLE_TEST_ROOT` to the absolute local Davy directory and run `node --test packages/chronicle/davy-config-integration.test.mjs` from the Operator app directory. It runs Davy's actual configuration loader with the built Chronicle/Obus packages, ChronicleStore, evidence bridge and request signer. Membership and voice use controlled adapters; HTTP responses and the game identity file are synthetic. No campaign data, Discord connection or model is used.

A successful fixture suite is not evidence of live voice capture, provider readiness, command installation, or release readiness. Those require the configured existing host and participating Discord accounts.
