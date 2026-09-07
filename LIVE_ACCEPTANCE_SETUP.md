# Live acceptance setup

This checklist applies only to the canonical local checkouts. It does not use
the OneDrive mirrors.

## Canonical paths

- Operator/Raphael: `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`
- Obus: `C:\Users\Hermes\Documents\obus-moa-exe`

## Private configuration required

Create `raphael-council/.env.local` locally, never in chat or source control,
with the private values required by the live adapters:

- `DISCORD_TOKEN`
- `RAPHAEL_GUILD_ID`
- `RAPHAEL_CHANNEL_ID`
- `RAPHAEL_CAMPAIGN_ID`
- the configured private Obus host-control credential
- the configured scoped local STT provider/model
- campaign image-provider credentials, when live image rendering is enabled

The bot check refuses to publish or log in until the Discord values exist.

## Readiness sequence

1. Start the canonical Obus service on its preserved local port.
2. Start the Raphael local host on port `38175`.
3. Run `node host/diagnostics.mjs` from `raphael-council`.
4. Require `reachable=true`, `localSttReady=true`, and an active campaign before live acceptance.
5. Run `npm run bot:check`.
6. Only after the check succeeds, run the separately authorized Discord publish/login step.
7. Exercise one GM plus two player session, reconnect, pending-roll recovery, campaign image, Chronicle, and adaptive-music flows.
8. Run coordinated checkpoint/restore against the real campaign stores and retain the manifest and hashes.

## Current evidence

The local hosts are reachable, the Obus contract is `raph-obus-game-v1`, campaign
RAG/provider allowlisting/Codex gating are enabled, and no active session or
private credentials are present. Therefore live gameplay is not claimed yet.
