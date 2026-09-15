# Discord engine integration — private AI runtime checkpoint

Date: 2026-09-12. Parent task: 01a093b5-34c6-7643-b0e2-ab54b8df52a2. Coordinator claim revision: 8, active.

This supersedes this file's intermediate notes and supplements CHECKPOINT-2026-09-12.md. The approved full plan remains active. This is a verified implementation slice, not public-beta or full-game certification.

## Connected behavior

The engine persists human_gm / ai_dm mode and an authority epoch. A paused, human-owned handoff delegates a restricted AI principal while retaining the human GM identity. Old authority cannot make new changes. Existing recorded commands can recover their original receipts after handoff or restart.

The real createCampaignAI path schedules a delegated narrative director in persisted AI mode. It handles pending describe, talk, and interact intentions through gm_resolve. It does not implement arbitrary mechanical rulings, full NPC planning, or the entire AI-DM design. AI player companions and human approval of scene artwork remain supported.

EngineClient preserves an explicitly supplied authorityEpoch while retaining the original shape of legacy requests. Before inference and commit, the director checks current principal, epoch, revision, pending intention and membership. Model evidence is limited to selected scene/intention context; no retrieval question, general personal memory, GM notes, or external routing is used.

Confirmed rulings continue to the next waiting intention without requiring a journal callback, with fresh authority checks and a maximum of three confirmed rulings per scheduler invocation. More than three requires another event. An uncertain send retains its original command/proposal and later events perform receipt-only recovery, including after handoff. This new director recovery state is memory-only: persistence across an app restart remains required work. Existing visual-player durable recovery is a separate mechanism.

## GM controls

The shared service and Discord Pause menu offer Human DM / AI DM while paused. Human takeover is available during pending rolls. The server generates or preserves the AI principal; the player interface does not ask for internal IDs or show authority epochs. Forged fields, stale panels, and unauthorized player requests are rejected. Existing pause/resume flow and receipt handling remain in use.

Changed files in this continuation:

- raphael-council/hollow-lantern/ai-runtime.mjs
- raphael-council/hollow-lantern/engine-client.mjs
- raphael-council/hollow-lantern/ai-director-runtime.test.mjs
- raphael-council/hollow-lantern/service.mjs
- raphael-council/hollow-lantern/service.test.mjs
- raphael-council/discord/hollow-lantern/components.mjs

## Managed private Obus service

The app's existing scripts/obus-game.ps1 reads its literal saved settings. Its configured endpoint is http://127.0.0.1:38176, different from the transport's 38175 default and the older recovery guide's 38178.

Root initially clean-started a default-port worker and passed an authenticated capability check and isolated local inference. After discovering the app's actual saved endpoint, root stopped only its own verified test worker (parent 12680, child 29564, matching executable, command line, parent relationship and creation time). No pre-existing service was stopped.

The existing managed launcher then started the private worker on 38176 with its configured Python environment. Its status command reports ready:true, managed:true, codexAvailable:false, freeRoutesAvailable:false. No app settings, token files, or real campaign policies were rewritten.

A second live smoke test used the actual configured 38176 endpoint and a new synthetic campaign, smoke_507e0ec17bfd41dea9552e7d874e9a8c. It acquired a fresh signed host lease, maintained that lease during inference, and requested an inline local-only intent with exportable:false and codex:false. Result: provider obus, model gpt-oss:20b, valid JSON ruling, destination local only, sources 0. Exact owned lease release was confirmed; command exited 0. Synthetic audit/runtime records remain. No real campaign content or Discord campaign mutation was involved.

The service contract requires scope.role host, not gm. Inline evidence must omit top-level contract (which triggers signed-reference validation) and question (which enables retrieval). A new worker boot needs fresh host leases; an already-running lifecycle that has marked its authority replaced cannot be assumed to reclaim automatically.

## Verification

The previous checkpoint records the passing C# suite, including 45 authority/mode checks and audience projection checks.

Root independently passed 52 Node tests from raphael-council:

    node --test hollow-lantern/ai-director-runtime.test.mjs hollow-lantern/ai-runtime.test.mjs hollow-lantern/engine-client.test.mjs hollow-lantern/visual-party.test.mjs hollow-lantern/party.test.mjs

The implementer passed another 125 tests in two commands from the project root:

    node --test raphael-council/hollow-lantern/service.test.mjs raphael-council/discord/hollow-lantern/hollow-lantern.test.mjs

58 passed, exit 0.

    node --test raphael-council/hollow-lantern/activity-runtime.test.mjs raphael-council/hollow-lantern/activity-transient-auth.test.mjs raphael-council/hollow-lantern/davy-host.test.mjs raphael-council/discord/hollow-lantern/enrollment.test.mjs raphael-council/discord/hollow-lantern/healing-allocation.test.mjs raphael-council/discord/hollow-lantern/map-detail.test.mjs

67 passed, exit 0. Total for these disjoint Node runs: 177 passed. Acceptance tests reproduced missing controls, outdated UI wording, stalled continuation and uncertain-result regeneration before their fixes.

Gortex impact, guards and contract analysis were used. Guards report no configured rules. Contract analysis allowed runtime behavior and reported broad transitive risk for shared presentation. Whole-repository change detection eventually completed but omitted untracked Hollow Lantern files, so it is not a complete slice diff. Several graph test mappings undercount actual executed coverage; pending indexing repeatedly delayed checks. These limitations are not represented as passing proof of full coverage.

## Recovery and remaining delivery work

Source snapshots: C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/node-director-before and gm-controls-before. Later director liveness changes are identified by Gortex receipts 168–178; UI copy final receipt 179. Roll back only this task's changes after comparing intervening edits. Source snapshots are not a live-save recovery drill.

Next work includes durable director receipt recovery; full tactical/story direction; complete player/GM walkthrough behavior; actual Discord/Unity cross-surface testing; remaining voice, memory, export/restore and beta acceptance criteria.

Figma's connector rejected its exact returned plan key; the browser route needs sign-in. Unity 6.3 LTS installation failed for Windows permissions, and the original install location was restored. Citadel's configured marketplace update succeeded at version 1.3.5. Existing Chronos supervision remains configured; its status is not game-health evidence. Remaining requested tool updates/integrations are not marked complete.

No paid service, external inference route, new recurring task, code commit, or public deployment was created.
