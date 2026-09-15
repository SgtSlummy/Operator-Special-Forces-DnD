# Operator/Raphael Acceptance Ledger

Updated: 2026-09-07 UTC
Canonical project: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`
Canonical Obus: `C:\Users\Hermes\Documents\obus-moa-exe`

## Verified locally

| Area | Evidence | State |
|---|---|---|
| Raphael application contracts | 1,188 repository tests passed; no failures or skips | PASS |
| Package artifacts | Chronicle 3/3, membership 3/3, Obus provider 3/3 | PASS |
| Tactical/world/recovery | Game, map, recovery contracts included in aggregate pass | PASS |
| Discord/Web | Auth, bridge, client, and Discord suites pass; simulation covers interface switching | PASS/SIMULATED |
| Obus AI policy | Host-generation, policy, outage fallback, provenance contracts pass | PASS |
| STT and chronicle | Consent, correction, receipt-only, voice lifecycle contracts pass; local STT fixture passed | PASS/SIMULATED |
| Campaign retrieval | Scoped RAG acceptance passed with tombstoned synthetic source | PASS/SIMULATED |
| Imagery/music | Image contracts pass; deterministic music rendered and served locally | PASS |
| Davy integration | Foundation, Discord, deck, audio, backup/restore, Windows checks pass | PASS |
| Windows package | `dist\\windows-heartbeat` produced with checksums | PASS |
| Local runtime | Davy, Raphael, game agent, and Obus core listeners present; core health 200 | PASS |
| Migration references | Active local launch/config audit reports zero OneDrive references | PASS |
| Backup preservation | Local backup inventory exists; 85,867 files recorded | PASS |

## Simulated before live campaign creation

- Synthetic two-player mixed Discord/browser session
- Scoped campaign retrieval and privacy exclusion
- Unsupported mechanics rejection before resource spend
- STT consent withdrawal and receipt-only behavior
- AI outage/manual fallback
- Five-role council evidence vote
- Host restart, checkpoint, generation fencing, and restore
- Final authored campaign/player values

## Still requiring explicit live or retirement evidence

- Supported Codex project-root rebinding away from legacy OneDrive registry
- Bounded retirement of the identified OneDrive project originals
- Cloud/recycle-bin deletion state, if requested separately
- Public HTTPS Discord Activity endpoint
- Live admin-private access gate
- Live test-guild acceptance gate
- Final real Discord voice session

No live or cloud requirement is represented as passed by simulation. OneDrive mirrors remain preserved until retirement evidence is accepted.

## Migration registry note

The supported Codex registry still contains the legacy OneDrive project path. No supported rebind operation is exposed by the current app tools. Runtime launchers and all active application configuration use the canonical local project; registry state remains an outstanding app-level migration item.
