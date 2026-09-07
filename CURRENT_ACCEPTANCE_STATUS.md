# Current acceptance status

Last updated: 2026-09-06

## Verified complete locally

- Canonical Operator checkout is outside OneDrive.
- Canonical Obus checkout is outside OneDrive.
- Local recovery backups and retirement evidence exist.
- Obus consumer contract suite passes.
- Tactical/world/council, Discord, character, imagery, storyboard/music, host, and recovery suites pass at their recorded scopes.
- Canonical local Obus can load the bundled Faster-Whisper model.
- Raphael local build passes through `npm run build:local`.
- Canonical Raphael dev hosting serves `/play` successfully on IPv6 loopback.
- The local-host production artifact starts and serves `/play` successfully on an isolated test port.

## Ready pending live authority

- Canonical local game-agent runs on the isolated migration port `38176`.
- Authenticated capability response reports `dependency_available=true`, `model_available=true`, and `ready=true` for local STT.
- Host-control key now exists locally and is never exposed in logs.
- Raphael local `.env.local` points at the canonical local Obus endpoint.

## Still requires real external state

- A real campaign and encounter with approved character records.
- A live host runtime lease and mixed GM/two-player session.
- Discord credentials and authorized publish/login.
- Real campaign image-provider credentials and rendering.
- Davy/browser audio capture with a real session.
- Final supported Codex project-path rebinding, if the app exposes that operation.
- OneDrive retirement only after the existing hold is cleared by semantic review.

No synthetic campaign data is promoted as acceptance evidence.
