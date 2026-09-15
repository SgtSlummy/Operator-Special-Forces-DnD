# Operation Hollow Lantern — local Unity rehearsal

This is development evidence from the real Unity main-thread authority and signed loopback bridge. It is not a Discord session, mobile review, or isolated simulated-human test. The controller has source and synthetic-DM knowledge.

## Build and campaign

- Unity: 2021.3.14f1 Windows standalone, `C:\Users\Hermes\LocalFiles\HollowLanternUnity-Prepared\HollowLantern.exe`.
- Authority assembly SHA-256: `1D3A53CE0E1513D40F6F1330364310BD3F566B3E272FC7C0702BAA30FF2C31DF`.
- Build evidence: `C:\Users\Hermes\LocalFiles\hollow-unity-prepared-build.log` (successful exit).
- Disposable campaign: `fixture-hollow-mission`; channel binding: `fixture-mission`; synthetic GM: `fixture-dm`; bridge port 18797.
- Store and evidence: `C:\Users\Hermes\LocalFiles\HollowLanternMission-20260909`.
- Gallery: [ordered visual record](<C:/Users/Hermes/LocalFiles/HollowLanternMission-20260909/index.html>).
- Machine-readable result: [result.json](<C:/Users/Hermes/LocalFiles/HollowLanternMission-20260909/result.json>).

Every record identifies its submitted intention, actor/owner scope, command identity, expected revision, committed receipt or rejection, before/after revisions, and five separately scoped rendered views. Each image has a SHA-256 digest and adjacent projection/native component payload. The images are explicitly labeled local rendered interface records; they are not Discord screenshots. Identical before/after revisions reuse the same evidence image.

## Outcome

The resumed run reached revision 77 with 78 recorded submissions: 77 commits and one expected empty-cache rejection. It includes 390 image captures across public, fighter, rogue, cleric, and DM scopes.

The path exercised approved preset enrollment, briefing conversation and explicit DM response, regional scene travel, scouting inspection/check, witness conversation, dungeon movement, initiative, Sacred Flame, fighter and rogue weapon attacks, a sentinel attack, turn advancement, encounter completion, cache discovery, explicit information sharing, finite loot, duplicate loot replay, empty-cache rejection, rescue ruling, shop sale/purchase, duplicate purchase replay, inventory transfer, weapon equipment, short-rest recovery, long-rest recovery, debrief ruling, and a durable checkpoint.

The first controller attempt failed its 16-turn bound because it incorrectly selected enemies by private HP. The engine correctly omitted enemy HP from a player's view. The controller was corrected to use the authorized `defeated` flag and resumed the disposable campaign. The failure is retained in `failure.json`, `failed-controller-walkthrough.json`, and revisions 0–41. This is therefore **a resumed run with a retained controller failure, not a clean first-pass mission acceptance**.

Process restart is a separate supervised step. `restart-check.json` contains the original final checkpoint request/receipt. After an external restart of this disposable Unity process, run `node raphael-council/hollow-lantern/mission-rehearsal.mjs --verify-restart`. It checks unchanged revision, exact checkpoint replay, read-only receipt recovery, and all five scoped views, then writes `restart-verified.json`. Read `result.json` for the current restart result; do not infer that restart was tested merely from the presence of the checkpoint.

## Engine and interface checks

- 59 Hollow Lantern deterministic assertions and 16 existing integration tests passed.
- 45 service, signed client, Davy host, component, privacy-rendering, and adapter tests passed across the focused suites.
- Actual Unity PlayMode test passed signed requests through the frame queue, scene transition, bootstrap/store restart, original command replay, and read-only receipt recovery. Evidence: `C:\Users\Hermes\LocalFiles\hollow-unity-prepared-playmode.xml`.
- The headless scene-view guard removes the previous null-shader exception. Unity still emits ordinary unsupported shader warnings under its Null graphics device; the bridge continues responding.

The three fixed level-three sheets validate point-buy/background arithmetic, HP, AC, skill/save training, ancestry, subclass, equipment grant, resources and spell selections. Private menus expose separate Skills, Features, Spells and Training pages. Feature entries distinguish automated resolution from DM-mediated adjudication. Preset enrollment is an authoritative ownership change and preserves existing belongings/progress.

## Release gaps demonstrated or still unverified

1. Rescue, social outcomes and debrief are explicit synthetic-DM narrative rulings. The engine does not yet persist authored rescue/objective/consequence flags or mechanically repair the signal network.
2. Regional travel is a DM scene transition. Authored route costs, choices and a complete world simulation are not implemented.
3. Some chosen class features are DM-mediated. Preserve Life currently allocates to one target per use; Heroic Inspiration rerolls, full Turn Undead effects, utility spell effects, stealth/Fast Hands/ritual adjudication, all ancestry nuances and generic armor changes are not fully automated. Manual creation and reviewed imports remain incomplete.
4. The public projection is conservative and currently omits NPC combat participants; illustrated public cards therefore do not yet prove the requested publicly observed attacker-versus-creature presentation.
5. Terrain is immutable and remembered cells use that exact authored terrain. Mutable remembered snapshots and comprehensive light/cover rules are not implemented.
6. No live Discord desktop/mobile walkthrough, blind visual-understanding test, voice/scribe/music acceptance, or Discord/web state-switching acceptance is claimed by this run.
7. Sequential individual rests advance world time individually. A coordinated simultaneous party-rest mechanic is not implemented.

The real campaign must not be described as release-ready on this evidence alone. Existing campaigns and the earlier browser fixture were not modified by this controller.
