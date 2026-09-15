# Reviewed Unity launch contract

This is the executed live launch contract as of 2026-09-09. Davy is connected to the selected human DM and the fresh campaign. Signed checks of all five audiences confirm revision zero, decisions paused, and unchanged save bytes after the latest engine cutover. This establishes deployment and read access; it does not certify a live mission or blind-user acceptance.

Executable: `C:\Users\Hermes\LocalFiles\HollowLanternUnity-PublicOutcomes\HollowLantern.exe`

Authority assembly SHA-256: `A75D0DDA0E4C283CE9F33CA58E8589A8633A3643ED4340FE6A0B67C8C526A998`. Build with Unity **2021.3.14f1** at `C:\Unity\2021.3.14f1\Editor\Unity.exe`; Unity Hub's newer default editor is not compatible with this verified build workflow.

Arguments: `-batchmode -nographics -logFile <absolute local live-engine log path>`

Use a hidden window when launching with `Start-Process`. Launch from the canonical project root `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`. The executable uses an explicit opt-in bootstrap and processes all bridge commands/projections on Unity's frame thread.

| Environment variable | Required live value |
| --- | --- |
| `HOLLOW_LANTERN_UNITY` | `1` |
| `HOLLOW_LANTERN_STORE` | `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\raphael-council\.runtime\hollow-lantern\live\campaign.json` |
| `HOLLOW_LANTERN_CAMPAIGN` | `operation-hollow-lantern`, matching Davy's selected campaign |
| `HOLLOW_LANTERN_CHANNEL` | `1546676505780944979` (actual channel name `dnd-arcade`) |
| `HOLLOW_LANTERN_GM` | `1230264975533281312`, Canna's Cammera Man (Stream Acc), selected by the user |
| `HOLLOW_LANTERN_PORT` | `18791` |
| `HOLLOW_FIGHTER_OWNER` | `ai-fighter` |
| `HOLLOW_ROGUE_OWNER` | `ai-rogue` |
| `HOLLOW_CLERIC_OWNER` | `ai-cleric` |
| `RAPHAEL_GAME_BRIDGE_SECRET` | Dedicated 32+ character bridge credential shared with Davy's engine client; never the Discord token |

Do not pass credentials in command-line arguments or print their values. The live service URL is `http://127.0.0.1:18791`. Verify signed GM/public/private projections before mounting gameplay controls. A missing store initializes the approved fresh party; an existing valid store is loaded without resetting its state. Campaign/channel/GM mismatches fail instead of silently repurposing a save. Initial random state is generated once and then saved; no seed environment variable is implemented.

The complete fresh prepared records and inventories are in [prepared-party.json](prepared-party.json), exported from the actual Unity revision-zero DM projection. They contain Mara Flint (fighter/Champion, 31 HP, AC19), Kestrel Vane (rogue/Thief/high elf, 24 HP, AC15), and Brother Ash (cleric/Life Domain, 24 HP, AC18), full resources, 18 skill modifiers each, trained saves, proficiencies, backgrounds, ancestry, selected spell lists, and automated-versus-DM-mediated feature tags. Read the remaining rule limits in the persistent mission report; this export does not certify unimplemented rule variants.

The latest verified disposable restart used this executable with its own fixture store and credential, changing PID35080 to PID9588. `C:\Users\Hermes\LocalFiles\HollowLanternMission-PublicOutcomes-20260909\restart-verified.json` proves unchanged revision81 and original receipt replay. That run contains 81 commits and 410 scoped images. Its fixture identities and stores must never replace live configuration.

The live process record is `.runtime/hollow-lantern/live/engine-process.json`; read it and verify the process executable before a restart instead of trusting a historical PID. The bridge secret is the sibling private `bridge-secret` file. Read it into the process environment without logging it. The latest cutover checkpoint and read-only verification are under `C:\Users\Hermes\LocalFiles\hollow-lantern\public-outcomes-cutover-20260909`. Stop and drain Davy before stopping Unity; preserve the latest live files together. Restore the same store, receipts, pending actions and event journal, then start Unity, verify signed scopes, and start Davy. Do not delete a store to recover a service.
