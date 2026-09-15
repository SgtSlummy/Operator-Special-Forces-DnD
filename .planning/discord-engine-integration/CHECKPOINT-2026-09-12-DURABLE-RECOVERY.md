# Durable AI DM recovery checkpoint — 2026-09-12

The full “do the plan” goal remains active. This checkpoint supersedes the memory-only recovery limitation in CHECKPOINT-2026-09-12-AI-RUNTIME.md. It does not certify all 45 illustrated states as implemented or authorize public deployment.

## Delivered

- AI DM writes the exact original command to a private SQLite journal before dispatch. A restart reloads that command with its original identity, authority epoch and revision. Recovery never invents a replacement command.
- Journal transactions use synchronous durability and compare-and-swap conflict protection. Corruption, campaign mismatch, stale writers and unsafe placement fail closed. Confirmation must match both command identity and the expected resulting revision; journal clearing completes before the in-memory pending state is dropped.
- The local runtime chooses a campaign-hashed database under private-data/director-recovery, outside public and art directories. The directory ignores runtime files in Git. No live campaign database was created during this work.
- Text-only AI DM supports human characters without a vision model or browser companions. Set HOLLOW_LANTERN_AI_COMPANIONS_ENABLED=false to use this option. The default remains true, and the live environment was not changed. Private model, authority, recovery and scene-art access checks remain enabled.
- Tests now wait for observable recovery events instead of relying on fixed delays.

## Verification

The final combined Node run passed 76 tests, zero failures, exit 0:

    node --test hollow-lantern/ai-director-runtime.test.mjs hollow-lantern/director-recovery-store.test.mjs hollow-lantern/ai-runtime.test.mjs hollow-lantern/engine-client.test.mjs hollow-lantern/visual-party.test.mjs hollow-lantern/party.test.mjs hollow-lantern/image-jobs.test.mjs hollow-lantern/commit-events.test.mjs

Run from the canonical project's raphael-council directory. Coverage includes a child process exiting during an uncommitted journal transaction, restart recovery, corrupt records, conflicting writers, receipt mismatch, unavailable vision/browser companions and scene-art authorization. Existing C# and Discord/service checks from the preceding checkpoint were not rerun because those files did not change in this slice.

Gortex source writes reported committed through receipt 245. Graph reconciliation and contract analysis timed out while indexing; the final post-edit detect also timed out. The tests are confirmed, but graph postchecks are not represented as complete. Individual guarded writes succeeded; earlier failed batch writes had rolled back and were not treated as applied.

## Remaining engine recovery constraint

Unknown command outcomes deliberately remain blocked until a matching engine receipt is found. Safe terminal cancellation is not implemented. The engine's LanternStore.Load automatically restores an older .bak when the primary state is missing or invalid. That can roll back authority epochs, revisions, receipts and any rejection marker kept in the same state file. Therefore a durable cancellation cannot safely rely only on an in-state tombstone or two separate client reads. The next engine design must make the resolution atomic and preserve its fence across backup restoration.

The director still processes at most three confirmed rulings per scheduler invocation; another event is needed for further work. Full isolated end-to-end campaign rehearsal and all 45-state acceptance remain outstanding.

## Local services and updates

The existing managed private Obus game service was rechecked ready on 127.0.0.1:38176, with Codex and free external routes unavailable. No live inference, campaign mutation or service restart was performed in this slice.

The local Obus source checkout is two commits ahead and zero behind the current upstream HEAD after a metadata-only fetch. No pull is needed; preserve its local commits and untracked game integration. This does not verify the installed desktop binary version.

Figma native delivery still requires the existing sign-in/access issue to be resolved. Unity 6.3 installation remains incomplete after the previously recorded Windows elevation failure. No new paid services, deployments, automations, durable tasks or OneDrive copies were created.

Canonical project: C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons.
Coordinator ownership and the persistent goal remain active for continued implementation.
