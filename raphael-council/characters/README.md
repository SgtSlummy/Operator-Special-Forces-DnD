# Raphael PDF character importer

Working local Node service for **2024 character PDFs**, including fillable exports,
flattened PDFs, scans, rotated scans, and mixed text/image pages. Players use Discord
buttons and plain-language corrections, not slash commands. This service imports
characters; it does not implement the rest of the adventure/rules engine.

## Host setup

Requirements: Node 22.13+ and a Discord application with a bot installed in your
server. Give the bot **View Channel**, **Send Messages**, and **Read Message History**
in the chosen campaign channel. Do not give Administrator. No Message Content or
Guild Members privileged intent is needed. Players must be current server members
and have either the configured campaign role or an explicitly listed player ID.

From the `raphael-council` directory:

```powershell
npm.cmd ci --ignore-scripts
```

Copy `.env.example` to `.env.local` **only if `.env.local` does not already exist**.
Otherwise add the missing variables to your existing file. Fill these in locally:

| Variable | Value |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from your Discord application's Bot settings; keep secret. |
| `RAPHAEL_GUILD_ID` | Your server's numeric ID. |
| `RAPHAEL_CHANNEL_ID` | The campaign channel's numeric ID. |
| `RAPHAEL_CAMPAIGN_ID` | Stable campaign key, such as `greyharbor`. |
| `RAPHAEL_PLAYER_ROLE_ID` | Campaign-player role's numeric ID, or use the player list below. |
| `RAPHAEL_PLAYER_IDS` | Optional comma-separated player IDs; membership is role OR list. |
| `RAPHAEL_DATA_DIR` | Optional dedicated private storage directory. |

Discord's Developer Mode makes numeric IDs available through Copy ID. Never paste
tokens, passwords, or cookies into chat or commit `.env.local`.

```powershell
npm.cmd run bot:check
npm.cmd run bot:publish
npm.cmd run bot
```

`bot:check` validates local configuration/assets without connecting. `bot:publish`
explicitly posts the character desk, or updates the previously published desk for
this campaign. `bot` keeps the buttons active and does not post a new public message.
Stop it with Ctrl+C. A separate SQLite host lock prevents competing host processes;
publishing the desk does not interrupt an active import.

No D&D Beyond login, API access, cloud OCR key, or Codex/Chronos automation is needed.
Dependencies and English recognition data are installed once through npm; OCR runs
locally. Discord itself still requires internet access and handles uploaded files.

## Player instructions

1. Export your character from D&D Beyond to PDF, or scan your printed sheet into PDF.
2. Press **My Hero**, then **Import PDF**. Upload one PDF and type **2024** to confirm
   it uses this campaign's rules. Limits: 10 MiB and 30 pages, subject to Discord's
   potentially lower channel upload limit.
3. Open **Review Import**. Status shows reading, local OCR, or ready for review.
   **Refresh** checks progress; leaving Discord does not discard a completed draft.
4. Use **Previous/Next** to inspect fields, warnings, and extracted source text.
   **Correct Details** accepts `My Dexterity is 16. My AC is 15.` or one correction
   per line, such as `Equipment: rope, lantern`. Corrections are all-or-nothing when
   ambiguous; no partial change is hidden from you. Low-confidence OCR candidates
   block approval until you confirm/correct them, for example `My Strength is 12`.
   Use `Initiative: unknown` to clear an unreadable optional value; required values
   still need to be supplied.
5. Correct required/conflicting fields, then press **Approve Import**. **View
   Character** reopens the saved character, including after a host restart.

For a newer sheet, use **Upload Updated PDF**. Changed fields show their previous
values. Approval creates a new character revision; it never restores campaign HP,
spent slots, consumables, conditions, or history. PDF HP shown in the sheet is a
source snapshot. Current resources are stored separately. Unknown current HP stays
unknown rather than assuming the character is healed.

Manual entry remains available through **Describe my hero**. Put readable field
corrections in the optional details box (`Name: Maren; Classes: Ranger 3; Level: 3`).
Missing fields can be added through **Correct Details** before approval.

## Parsing and limits

- `pdf-lib` reads fillable fields; PDF.js extracts positioned text and renders pages;
  Tesseract.js performs OCR. Existing machine-readable values take precedence over
  OCR of those same characters. Conflicting explicit readings remain unresolved.
- Named-field D&D Beyond-style exports and the publisher's official 2024 cropped
  sheet have mappings. Anonymous `TextN` names are recognized only with structural
  layout anchors. Other layouts use explicit labels, cautious positional extraction,
  and player correction; arbitrary or handwritten sheets are not guaranteed to map
  automatically. An unsupported field is never silently assigned a made-up stat.
- Retains displayed ability modifiers, skills/saves, AC/HP/speed, equipment, attacks,
  spells, features, page provenance, and warnings. Spell/feature text is descriptive,
  not automatic rules execution or a license to retrieve purchased books.
- English printed text is the supported OCR target. Unclear handwriting requires
  review. Core identity, class, level, six abilities, AC and maximum HP are required
  for approval. Other missing modifiers remain unknown, not zero.
- One active import per player/campaign, at most 20 active in-process jobs, one OCR
  subprocess at a time, ten-minute processing deadline, 16-million-pixel render cap.
  The subprocess has a 256 MiB V8 heap limit (not a total native/WASM memory quota).
- Password-protected, malformed and oversized PDFs are rejected. The worker runs
  without bot credentials, PDF evaluation is disabled, and its Node HTTP/TCP/fetch
  networking is blocked by a preload inherited by OCR worker threads. This is
  application-level hardening, not a claim of an OS security sandbox.
- Page text and each field are bounded. Long source text is paginated; excessive
  source text is omitted with a warning. Read your original PDF for complete detail.

## Persistence, privacy and recovery

By default, Windows data is under
`%LOCALAPPDATA%\Raphael\character-importer`, outside this OneDrive workspace.
Other hosts use local application data or `~/.local/share/Raphael/character-importer`.
Only override this with a dedicated directory you control. Restrict filesystem
permissions and use disk encryption for private character records.

SQLite stores owner/campaign-scoped jobs, drafts, immutable approved revisions,
approval events and private view bindings. Transactions prevent duplicate approval
or lost updates. Existing browser localStorage campaigns are not migrated or changed.
Use `CharacterStore.character({campaign, owner})` to obtain the approved snapshot
and **separate** runtime resources when wiring the future game/rules adapter.

Downloaded source PDFs use random filenames in `sources/`; rendered images stay in
worker memory. Sources are removed on approval, cancellation or failure. Abandoned
drafts/sources expire after 24 hours while the host is running, or at its next start.
Accepted character fields and their bounded textual provenance remain in revision
history. This does not delete Discord's copies or erase already-delivered ephemeral
messages. Logs contain job IDs, outcomes and durations, not PDF text or tokens.

A crash leaves the last approved character intact. On restart, interrupted OCR jobs
become retryable failures; completed review drafts remain available until expiry.
Do not run the game from a sync-shared live SQLite database. To back up or roll back,
stop the bot and copy the private data directory; never replace it while running.
Disabling the bot leaves browser saves and existing character revisions intact.

## Verification

```powershell
npm.cmd run test:characters
npx.cmd eslint characters discord --max-warnings 0
```

Tests cover offline OCR in the real subprocess; fillable/flattened/scanned/rotated/
mixed sheets; malformed and encrypted rejection; corrections; access boundaries;
private Discord JSON payloads; cancellation, timeout, restart and expiry; duplicate
approval and live-resource preservation. The Discord protocol test uses a fake
transport with the real importer/database, **not** a live Discord server.

Optional publisher-template QA (explicit network download of the blank sheet, no
player data): `node characters/official-template-check.mjs`. The test fills synthetic
values, checks PDF fields and OCR, and produces a local inspection PNG in `tmp/`.

Live release gate, still requiring a configured bot/server:

1. Publish the desk in a test channel and start the bot.
2. As an allowed player, upload a 2024 sheet, review/correct it and approve.
3. Confirm another player cannot see/use its private draft.
4. Restart the bot and reopen **My Hero → View Character**.
5. Upload an updated sheet, approve the diff, and verify live resources are preserved.

Repository-wide lint currently also reports an existing React effect issue in the
browser prototype. Its pre-existing framework dependency advisories are separate
from this importer; the newly used Discord WebSocket dependency is pinned to a
patched release. Do not use a forced dependency upgrade as an importer setup step.
