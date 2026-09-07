# Operator / Raphael acceptance matrix

Updated: 2026-09-07 UTC
Canonical Operator: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`
Canonical Obus: `C:\Users\Hermes\Documents\obus-moa-exe`

This matrix is evidence-based. A green local test is not a claim of live Discord, credentials, model, or mixed-player readiness.

| Requirement | Current state | Evidence or remaining gate |
|---|---|---|
| Shared Discord/Web game state | Partial | Local game suite 620/620; live mixed-interface Discord/Web session remains open. |
| Obus sole AI/speech boundary | Partial | Obus contract and provider suites pass; live host authority, STT route, and inference remain open. |
| Campaign-scoped RAG/provenance | Partial | AI/provider suites pass; diagnostics report metadata unavailable and inference not-run. |
| Human DM companion and automated mode | Partial | Chronicle/core/runtime tests pass; live Davy composition remains open. |
| Scribe, consent, corrections, recap | Partial | Character/Discord suite 186/186 and Chronicle suites pass; real Discord voice remains open. |
| Tactical mechanics and map behavior | Verified locally | Game/map suite 620/620; live player acceptance remains open. |
| Greyharbor world/council persistence | Verified locally | Game/world/adjudication and council-related tests pass; configured live campaign not proven. |
| Campaign imagery and deterministic snapshots | Verified locally | Image suite 48/48; live generation/provider availability remains open. |
| 30-panel storyboard | Verified locally | 30 panels, 6 acts, 18 cited entries; runtime walkthrough not externally hosted. |
| Adaptive music | Partial | Coordinator, runtime hook, and tests pass; live Davy playback remains open. |
| Windows/local hosting | Partial | Lint passes; `RAPHAEL_LOCAL_HOST=1` build passes; bot check awaits private `.env.local`. |
| Migration away from OneDrive | Partial / HOLD | Local backups and audit exist; 7 source/test divergences require semantic review. Do not delete OneDrive yet. |

## Required live acceptance gates

1. Configure private bot and campaign values in local `.env.local`; never place secrets in this repository or chat.
2. Register the private Obus game-host generation and session lease using the current scoped runtime fence.
3. Verify local STT dependency/model readiness and run a real receipt-only transcription.
4. Run one GM plus two-player mixed Discord/Web session with restart recovery and all-AI-unavailable fallback.
5. Exercise Davy's existing gateway and shared music ownership with adaptive cues, narration ducking, and break silence.
6. Re-run migration comparison after all local source/test divergences are semantically reconciled; only then issue retirement evidence.

## Evidence index

- `PROJECT_RECOVERY_PLAN.md`
- `PROJECT_EXECUTION_LOG.md`
- `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-host-diagnostics-latest.log`
- `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-game-suite.log`
- `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-image-suite.log`
- `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-characters-discord-suite.log`
- `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\recovery-20260907-rag-provider-tests.log`
- `C:\Users\Hermes\LocalFiles\MigrationReports\20260907T002707Z\operator-recovery-retirement-audit.json`
