# Design package verification

Verified 2026-09-11 Pacific / 2026-09-12 UTC.

## Delivered

- `RUN-TEMPLATE.md`: reusable run card, channel/visibility plan, all 34 player steps, generic message copy, Saltglass worked example, sourced Discord constraints, implementation requirements and live rehearsal criteria.
- `player-walkthrough.html`: self-contained interactive mockup fragment, usable in the Codex preview and a desktop browser. Inputs and navigation are local simulations.
- `storyboard.html`: index of all 34 full-size screenshots.
- `screens/01-welcome.png` through `screens/34-correction.png`: one desktop mockup image for each step.
- `preview-desktop.png`, `preview-mobile.png`, `preview-light.png`, `storyboard-overview.png`: additional checked views.

## Checks actually completed

The mockup was opened in local Microsoft Edge through Playwright. The bundled Playwright headless Chromium executable was absent, so the installed Edge browser was used successfully. No browser installation was performed.

| Check | Actual result |
|---|---|
| Screen inventory | 34 steps loaded |
| Initial script startup | Ready; UTF-8; no page errors |
| Layout combinations | 34 screens × 4 widths × 2 themes = 272 checks |
| Widths | 320, 360, 736 and 1024 pixels |
| Themes | Light and dark |
| Horizontal clipping | None detected at the tested widths |
| Declared message actions | 80 button actions tested; each changed the view or produced a response |
| Character setup path | Welcome → agreement → text-only preference → character choice → personalization → review → pending → example approval → introduction |
| Required field validation | Whitespace-only character name blocked with guidance |
| Input preservation / escaping | Updated introduction retained; angle-bracket input displayed as text |
| Action form | Submission produced a received receipt |
| Correction form | Submission produced a pending-review receipt |
| Sheet form | Submission reached the pending-review screen |
| Screenshot gallery | 34 images loaded; no broken images; no horizontal overflow at 1024 pixels |
| Visual inspection | Desktop welcome, narrow turn screen, light character form, and gallery overview inspected |

These checks cover this artifact only. Width-based browser checks are not testing on physical phones or Discord clients. No real game roll, sheet validation, GM approval, multiplayer synchronization, resource mutation, voice handling or durable game save was exercised.

## Gortex and Coordinator

Gortex was used to retrieve project context, record design constraints, assess proposed files and perform guarded file writes. The new artifacts initially returned `file_not_indexed` during impact checks because they did not exist in the graph. A later HTML impact report included common-name relationships such as `esc` to other project files; this self-contained walkthrough has no imports of those files and no runtime connection to the game.

Post-edit `change.detect` was attempted with the supported repository-wide scope. It twice refused a stale graph while the storyboard mutation receipt was still pending. No changed-symbol IDs were returned. Follow-on tests, guards and contract calls did not run: those operations required symbol IDs or a different explicit source. These graph checks are unavailable, not passed. The browser checks above are independent evidence about the mockup.

The Coordinator board was checked, and this task claimed only `.planning/design/discord-campaign-run-template`. No other task's claimed source paths were edited. Work remained in the canonical local project, outside OneDrive. The design folder was untracked in Git at delivery; no commit or push was made.

Citadel's design route preflight returned `ACTIVATION_AUTHORITY_BLOCKED / CONFIG_FAIL_CLOSED`, including the unknown configuration field `trust.sessions_completed`. The blocked route was not invoked and its configuration was not repaired. Design and research proceeded directly within the requested scope.

## Scope of completion

The design, reusable copy, interactive player screens and screenshot set are complete. Actual Discord setup or bot implementation is a separate task. The template lists concrete live acceptance checks for a GM and two player accounts; those checks remain unperformed.

No messages were posted to Discord. No bot, game logic, deployment, live campaign store, approved character sheet or shared game art was modified. Example successful outcomes, character approvals and saved checkpoints remain illustrative.
