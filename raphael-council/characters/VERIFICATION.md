# Character importer verification - 2026-09-05

## Implemented and checked locally

| Check | Result |
| --- | --- |
| `npm.cmd run test:characters` | 78 tests passed; zero failures/skips. Includes the original deck checks. |
| `npx.cmd eslint characters discord --max-warnings 0` | Passed. |
| `npm.cmd run build` | Passed; browser prototype remains buildable. |
| `node characters/official-template-check.mjs` | All 14 tested core values match the publisher's filled, flattened, and scanned 2024 sheet. Low-confidence readings require player confirmation. |
| Offline OCR | Real OCR subprocess passes scanned/rotated/mixed fixture tests with HTTP/TCP/fetch disabled by inherited preload. No cloud OCR used. |
| Discord protocol integration | Real import/OCR/SQLite pipeline with fake Discord transport: upload, private review, correction, approval, source cleanup, restart, reopen saved character. |
| Persistence and authorization | Duplicate approvals, stale views, cross-player/campaign access, interrupted jobs, expiry, cancellation, timeout and preservation of live resources tested. |

The test-first initial gap was the missing **Import PDF** button: the new regression
failed while the original 48 deck checks passed. A second observed failing regression
proved low-confidence OCR previously did not block approval; that gate is now tested.

Publisher-layout investigation established three implementation constraints: its
actual crop size is 603 x 774 points; anonymous `TextN` fields require geometry guards;
and sparse OCR can interleave different columns between a multi-line label's words.
Region crop bounds round outward to avoid clipping a digit at a pixel boundary.
The inspection PNG is generated under ignored `tmp/character-qa/` using synthetic
character values, not a real player's information.

## External gate still incomplete

`npm.cmd run bot:check` correctly reports that `.env.local` and the bot/server/channel
configuration are missing. No Discord login or live post was attempted. The live
upload -> OCR -> approve -> restart -> reopen smoke test remains unperformed. Follow
the host setup and live checklist in `README.md`; the protocol test is not a substitute
for that gate.

## Existing project issues, not changed by this feature

- Repository-wide lint reports the React `set-state-in-effect` issue in
  `app/page.tsx:171`. That file was not edited.
- Production dependency audit reports three high-severity package entries in the
  existing browser framework tree: `next`, its `postcss`, and `sharp`. No forced
  framework upgrade was performed. The Discord adapter's `ws` is separately pinned
  to patched version 8.21.3; the older development-tool WebSocket dependency remains.
- Node 22 emits its standard experimental SQLite warning. Test fixture rendering
  emits PDF.js font notices; the production parser supplies local font data and
  does not return parser output or document content to logs.

Overall: local implementation verified; live Discord release verification incomplete.
