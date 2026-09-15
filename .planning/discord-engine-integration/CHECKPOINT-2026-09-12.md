# Engine integration checkpoint — 2026-09-12

The complete accepted plan in IMPLEMENTATION.md remains the objective. This checkpoint records partial implementation, not public-beta readiness. The active task retains Coordinator claim revision 4; its paths include the engine changes below, the intended Node AI runtime adapter, and this folder.

## Implemented and tested

- LanternState.cs persists DirectorMode (legacy default human_gm), AuthorityEpoch (default 0), and AiDirectorId.
- LanternAuthority.cs implements human-owner-only gm_director_mode while paused, scoped ai-director: delegation, mandatory AI authorityEpoch, restricted ruling/NPC commands, and preservation of pending player choices. GmId remains fixed. Historical receipts remain immutable and replayable after handoff and restart.
- LanternDirectorModeTests.cs adds 45 acceptance checks, registered in Program.cs.
- LanternProjection.cs exposes directorMode and authorityEpoch to all permitted audiences, and aiDirectorId only to authenticated GM views.
- LanternDirectorProjectionTests.cs verifies legacy defaults, AI mode metadata, delegation privacy, unchanged audience filtering, and rejection of AI access to GM projection. Program.cs registers it.

The final combined command `dotnet run --project RPG-Core/RpgIntegration.Tests --no-restore` exited 0 with both new suites registered, all 45 director checks, and existing Lantern, armor, inspiration, Preserve Life, map, terrain, presentation, journal and runtime integration suites. Tests were observed failing before the corresponding implementation. No real multiplayer/Discord/Unity playtest is claimed.

Source-only rollback snapshots:

- C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/engine-director-before
- C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/projection-before

These snapshots are not proof of live-save recovery or a hardware-independent backup.

## Verification limits

Gortex pre-edit impact assessments passed. Director tests were found by its test mapping. Projection mapping did not link the new executed tests. Guards returned no configured rules. Final detect and contract calls timed out or remained pending, so those checks are unverified. A targeted reindex timed out; later successful impact checks showed the queue had caught up enough to resume guarded edits. Do not duplicate any mutation whose disk receipt is committed.

Updating IMPLEMENTATION.md via batch transaction discord-engine-ledger-checkpoint-20260912-1 was rolled back: Windows reported the file in use during replacement. The original ledger remains intact. This new checkpoint supersedes its initial implementation-status observations without changing its requirements.

## Next implementation seam

Node AI-DM integration is not implemented. Existing raphael-council/hollow-lantern/ai-runtime.mjs controls AI player companions, not the DM. Preserve human-GM companion behavior and human art approval. Its createLocalCampaignAI -> createCampaignAI initialization and host.onCommitted subscription are the integration seam; party client is host.engine.

Before connecting the director, verify host.engine command/receipt methods, committed player-intention event shape, existing runtime test stubs, and the private-only inference contract in ai/obus.mjs and ai/host-control.mjs. General Obus routing includes cloud providers, so local naming or a localPolicy object is insufficient proof of private-only gameplay. Gortex task discovery timed out and returned localization_in_progress/required_action wait. No Node edits or model requests were made.

Then continue the campaign registry, recoverable presentation events, versioned run template/rules, all 45 functional UI states, fair private inference queue, consented voice, Unity migration, Figma design and free public-beta gates. Do not narrow completion to the engine changes above.

## Tool and application results

- Citadel: official marketplace refresh and plugin install succeeded; installed version remains 1.3.5. No plugin cache was manually patched. Other requested software/plugin upgrades remain unverified.
- Coordinator: own claim revision 4; three active claims. Foreign changes retained, no branch switch, broad staging or commit.
- Chronos: existing Governor and active chronos-governor-pulse verified. No new recurrence. Heartbeat status reports prior-state/unsupported coverage; it does not prove gameplay monitoring.
- Obus: loopback endpoint 127.0.0.1:38174 reachable; local gpt-oss:20b available but cold. No gameplay inference was executed. Hermes memory bridge reports ready; no campaign data was written to shared memory.
- Figma: connector whoami returned a single Starter/View team. create_new_file with its exact returned key failed Invalid planKey. Browser fallback is signed out; sign-in tab retained. No draft created and no paid seat requested.
- Unity: station remains 2021.3.14f1. Installed editor registry shows 6000.6.0f1 with Web support. Official 6000.3.24f1 plus Web download succeeded, but installation failed ELEVATION_FAILED even at a writable user location; Web failed due to its parent dependency. Original install location C:/Program Files/Unity/Hub/Editor restored and verified. No project migration occurred.

Unity 6.3 requires a successful supported installation by a user with the needed Windows permissions. Figma requires a working draft-creation connection or signed-in browser. These external gates do not block continued engine/application implementation.

## Goal status

Active and incomplete. Do not mark complete until every requirement in IMPLEMENTATION.md has direct current evidence, including public rollout and both-mode real sessions.
