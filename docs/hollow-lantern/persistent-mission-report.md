# Persistent mission rehearsal — current engine

The fresh mission passed through the same scoped presentation service used by the table, the signed bridge, and the actual Unity main-thread authority. Every positive submission records a currently offered action ID. This is a development controller with synthetic DM authority, not an isolated player tester or a live Discord session.

## Result

- [Current result](<C:/Users/Hermes/LocalFiles/HollowLanternMission-Verified-20260909/result.json>) and [ordered visual gallery](<C:/Users/Hermes/LocalFiles/HollowLanternMission-Verified-20260909/index.html>).
- 88 submissions; 87 commits; one intentional `LOOT_EMPTY` rejection. No unexpected controller or engine failures in this fresh run.
- 440 rendered interface records: public, fighter, rogue, cleric and DM for revisions 0–87. Before/after links, scoped projection/native panel JSON, image hashes, original intentions and authoritative receipts accompany the record.
- Iona Vale rescued at world minute 112; signal repaired at minute 134; convoy guided to safety; all five routes travelled; debrief marked complete.
- Final checkpoint saved at revision 87. A separately supervised restart verified the exact owned executable, stopped only fixture PID22064, and launched PID9372 against the same store/secret. Revision87, original checkpoint replay, read-only receipt lookup and all five scoped projections passed. `restart-process-record.json`, `restart-verified.json`, and `restart.log` preserve the evidence.

Build: `C:\Users\Hermes\LocalFiles\HollowLanternUnity-Mission\HollowLantern.exe`, Unity 2021.3.14f1. Authority assembly SHA-256: `2DD5B16011DCC91C4DE245CEAF71A176A1C0FC32ABDAF48C751E85628231A510`. The disposable fixture uses port 18799, campaign `fixture-hollow-mission`, channel `fixture-mission`, and synthetic DM `fixture-dm`. Its store is inside the gallery directory. Existing campaigns are separate.

The run exercises preset enrollment, private sheets, briefing, route discovery and explicit sharing, checked party travel, scouting/social rulings, tactical movement, initiative, all three party attacks, an NPC attack, encounter completion, finite loot and duplicate replay, cache exhaustion, nearby rescue, nearby signal repair, shop sale/purchase and duplicate replay, transfer/equip, short and long rests, persistent consequences, and final debrief/checkpoint.

## Mission contract

`mission_action {actionId}` creates a typed pending request. A GM-approved `gm_resolve` rechecks the requester's position and prerequisites, applies the authored result once, records the public milestone, and pauses decisions for the next briefing.

| Action | Required position and prerequisite | Authored result |
| --- | --- | --- |
| `accept-briefing` | Within one square of briefing table `(4,4)` | Briefed flag; approved route disclosure to the party |
| `negotiate-passage` | Visible sentinel within six squares; personally known convoy proof; before combat | Persisted negotiated passage; sentinel pacified |
| `rescue-technician` | Within one square of Iona `(8,6)` in rescue scene; threat defeated or negotiated | Rescue flag and timestamp; 10 world minutes |
| `repair-signal` | Within one square of relay console `(10,6)`; Iona rescued and threat resolved | Repair flag/timestamp; 20 minutes; lasting convoy outcome |
| `complete-debrief` | Within one square of debrief table `(4,4)`; rescue and repair complete | Mission-complete flag and escort conclusion |

Coordinates above are engine coordinates; visible map labels add one to each coordinate. The sentinel begins at `(7,6)` in the signal dungeon.

`scout_route {}` spends ten world minutes and resolves Perception against 12. Success records `route:signal-dungeon` and `convoy-proof` only for that character. Existing explicit `share` transfers either discovery to a nearby companion. The proof is a protected journal discovery, not a loose trade item.

`travel {destinationId,actorIds?}` creates a pending journey. The destination must be an authored connected route known to the requester, and every selected traveller must remain in the departure scene within six squares until approval. Default travel requires the whole party to regroup. Only a GM acting through a selected character can supply an explicit subgroup. Approval alone applies the cost and moves exactly that group.

| Route | World minutes |
| --- | ---: |
| Briefing → Lantern Road | 20 |
| Lantern Road → Signal House | 30 |
| Signal House → rescue chamber | 10 |
| Rescue chamber → quartermaster | 60 |
| Quartermaster → debrief | 5 |

Repair by world minute 240 guides the convoy to safety. Later repair saves survivors but loses supplies. Both outcomes persist across saves. The DM briefing should communicate this four-hour deadline.

## Validation

The engine suite passes 80 focused assertions plus 16 existing integration tests. New tests cover unapproved milestones, one-time travel cost, private route knowledge, explicit sharing, saved route/objective/consequence state, remote rescue rejection, proximity revalidation at approval, delayed repair, completion, proof-gated negotiation, pacification, split-party rejection, GM-only subgroup selection, and public NPC visibility without private HP.

All 50 focused JavaScript tests pass, covering service action selection, authorization/replay, signed receipt recovery, Davy composition, component privacy, dropdowns, GM/NPC controls, scoped render output and mission controls. A dedicated regression test ensures a missing expected error code can never classify an unexpected controller error as a passing rejection.

Two earlier rehearsals remain preserved. The first controller incorrectly consulted withheld enemy HP and hit its turn bound. The second redundantly requested opening already-open combat decisions; its original error classification was audited and corrected to `FAIL` in both JSON and HTML. Their evidence is in `HollowLanternMission-20260909` and `HollowLanternMission-Clean-20260909`. Neither is represented as this final clean run.

## Remaining acceptance limits

The evidence images are local rendered interface records, not Discord desktop/mobile screenshots. Live Discord, independent screenshot-only human-style tests, voice/scribe/music, and cross-surface acceptance are separate work.

The public NPC now appears only when every party character currently sees it. Visual inspection confirmed the portraits and tactical texture load, but the sentinel lacks approved portrait art and appears as a red placeholder in this controller. The controller uses the approved cover as its public scene background; runtime scene-specific generation is a separate integration.

Complete 2024 automation is not claimed. Manual/import character enrollment, full feat/subclass variants, multi-target Preserve Life allocation, Heroic Inspiration rerolls, full utility-spell/Turn Undead/stealth/ritual effects, generic armor changes, and simultaneous party rests remain incomplete or explicitly DM-mediated. The selected fixed sheets and the authored mission have bounded supported paths; broader rules must not be inferred from their existence.
