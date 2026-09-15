# Production implementation — 15 September 2026

Status: **not released**. The production candidate has substantial implementation and component evidence. The public service still runs the original paused revision-80 campaign; its save SHA-256 remains `22eaaae44bb7a322f7d34ed2415f7ea02a047afb5a0e54ecf004fe2cf5a2efb1`.

## Implemented

- Separate explicit production profile with 100-human capacity, admission stages 20/50/100, verified GM identity, private Obus endpoint, Chronicle and recovery bindings. No AI-owned human seats.
- Durable shared admission for browser and Discord. One reservation/character per account, safe-boundary admission, current membership checks and fail-closed revocation. Raw Discord member/guild events invalidate cached grants even for uncached members.
- Production director queue with fair actor selection, generation leases, durable command identity, current revision/epoch/ownership checks and immediate cancellation on observed human takeover. It executes only supported deterministic procedures; unsupported mechanics require a GM ruling. Unrelated revisions can reuse narrative inference only when the entire authorized character projection remains identical except its revision.
- Fresh campaign factory with seven persistent characters: Captain Elin Vale, Tamsin Reed, Quartermaster Orin, Signal technician Iona Vale, The Brass Warden, East Watch Automaton and West Watch Automaton. The technician retains opaque stable ID `technician-iven`. No production campaign has been publicly initialized yet.
- Version-2 checkpointed/segmented storage, legacy reading, permanent receipts and exact archived public events. Checkpoints at 50 commands or 64 MiB. Recovery holds writes without changing the saved human pause intent.
- Owned production supervisor and guarded after-sign-in installer. Voice startup uses Davy's existing player, joins only the configured room and starts self-deafened; recording remains controlled by Chronicle consent. Chronicle now accepts enrolled ordinary players with current guild/channel eligibility.
- Table layout based on the supplied Foundry reference: character sheet on the left, central map and actions/results on the right; responsive mobile layout and accessible onboarding controls.
- Consistent-backup primitives, canonical database exporters, integrity validation and retention selection. **The live cross-process quiescence coordinator and automatic schedule are not integrated.**

## Evidence

All evidence is under `C:/Users/Hermes/LocalFiles/DnDOps/production-implementation-20260915`.

| Check | Result and limit |
|---|---|
| Existing campaign archive | `archive-revision80-verified/manifest.json` preserves all four original files and hashes. `archive-revision80` is an earlier incomplete attempt and is not a valid restore point. |
| Windows build | Unity 2021.3.14f1 Windows x64 Development build succeeded using the preserved Hollow Lantern scene. Candidate: `unity-candidate/HollowLantern.exe`. Existing unrelated CS0168 warning remains. |
| Storage/factory | Full .NET suite passed, including 90 new storage checks and 38 production-factory checks. See `storage/STORAGE_V2.md` and `storage/FACTORY_VERIFICATION.md`. |
| Actual Unity/admission | `engine-acceptance-57255f8c-579f-48a6-a158-8d321ac08963/report.json`: 100 distinct simulated accounts plus seven NPCs; duplicate joins stable; cross-character view denied; 300/300 valid private views, p95 2,567 ms. Checkpoint sequence 100. |
| Actual engine recovery | Same report: running save recovered in 1,416 ms; paused save in 1,403 ms. Revision, roster and pause intent preserved. Verified archive contains 2,826 files. This is engine/admission evidence, not a full-stack or restore rehearsal. |
| Director | `director-final-tests.log`: 41 tests passed, including pause cancellation, stale-context rejection, isolation and durable uncertainty. `director-protocol-tests.log`: 58 protocol/director checks passed before the additional cancellation test. |
| Runtime composition | `runtime/production-composition-tests.log`: 22 tests passed. `runtime/davy-production-health-tests.log`: 32 passed, three existing skipped. Startup script parsed; no startup task was installed. |
| Chronicle | 26 Davy config/voice checks, 13 portable-host checks and three artifact checks passed. Chronicle bundle SHA-256: `083ec0d0ddcbbbb6949bf25c74846e29712cda0c82b4c932d78cb126bef530a2`. |
| Browser layout | TypeScript passed. Actual components built in an isolated fixture preview; desktop/mobile navigation and overflow checks passed. `ui/UI_VERIFICATION.md` and screenshots contain evidence. Production web output was not overwritten. |

Candidate domain DLL SHA-256: `1cc5f04a4fbbd4e0a26e15fb7a85ab0525efb960aed2ad549f0f96251de29750`. Source hashes/revisions are recorded in the evidence manifest. These candidates have not passed release acceptance.

## Work still required before deployment completion

1. Resolve the original private Obus game-worker launch rejection through a permitted path. Automatic approval review previously rejected that launch as **“blocked by policy.”** Port 38178 is still offline. No alternate worker/model/port or launch retry was used.
2. Integrate a real, bounded coordinator for consistent live backups across engine, admission, director, Chronicle, browser auth and database/queue producers; activate the 15-minute schedule and retention; restore every store together into isolation and verify receipts, ownership and NPC history.
3. Finish concrete production descriptors/stores/channel manifests, identify full application release artifacts, reconcile the legacy automatic gateway and install the validated sign-in supervisor. Preserve the old archive and keep fresh public initialization after disposable acceptance.
4. Run the complete mixed browser/Discord mission with actual accounts, human takeover during inference, persistent stock/boss defeat/revisits, consented speech, withdrawal, private-text isolation and GM-corrected duplicate-safe recap publication.
5. Run the two-hour full-stack 100-user rehearsal (50 browser/50 Discord adapters) at the requested rates, with live AI and shared voice. The short engine test does not substitute for it. Require p95 <=5 seconds, >=99.9% valid-request success, bounded queues and zero lost actions, duplicate effects or leaks.
6. Rehearse actual Windows restart/sign-in, dependency/port failures, uncertain delivery and all-store restore. Verify independent external-network OAuth and play through the existing HTTPS address. Then advance admission through 20/50/100 only on passing evidence.

Rollback must preserve newly committed history and storage compatibility. The original public deployment was not switched during this implementation. See `production-runtime-runbook.md` for implemented controls and the explicit backup-integration boundary.
