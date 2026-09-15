# Visual play readiness — 10 September 2026

The illustrated Activity and authored-terrain Unity build are running. Current web release: `3f003faa559417ff4cea89d30554812e97878ae9a2be01b6378bb72ef8deb432`, web PID 29500, launcher PID 39112, port 18796; edge PID 41088 remains on 18805. The new screenshot-driven AI party is implemented and tested in source, but live visual AI play is **not released**. The existing private Obus worker does not advertise the required screenshot capability; its proposed same-port restart was rejected by automatic approval review, including the attempt made after fresh user authorization. No alternative restart was attempted.

## Published interface and engine

- The Activity uses local Stable Diffusion scene art, round character portraits, contextual action buttons and grouped dropdowns. The map opens in an in-app expanded view, including on narrow phone screens.
- All six phases have installed local scene art: briefing, coastal road, signal house, rescue, harbor shop and debrief. Rejected candidates were retained outside the approved catalogue. The debrief art does not imply a successful mission outcome.
- Access errors now display only the launching account's verified identity, with distinct reasons for missing enrollment, ineligibility, removed GM authority, and unavailable Discord verification. This grants no additional permissions and preserves existing sessions.
- Tactical rendering distinguishes difficult ground, walls, currently visible and remembered terrain, character tokens, cover and obscurement when the campaign supplies those authored rules. Regional and dungeon views show discovered routes and the current location.
- Scene images and portraits use authenticated, scoped, uncached image routes. Unknown map pixels are removed before image delivery. Illustrations supply atmosphere; the engine's grid remains the terrain authority.
- Unity now supports authored cover/obscurement, selected-square weapon attacks and source-aware checks. Existing saves retain terrain version 0. The GM's **Prepare terrain** control is offered only for a fresh paused briefing; it is not silently applied to an existing campaign.
- Known validation failures can clear the browser's pending action only with an explicit matching pre-dispatch rejection. Ambiguous submissions preserve their command identity for receipt recovery.

The original campaign remains `operation-hollow-lantern`, revision 0, paused. The separate Discord rehearsal remains `hollow-lantern-rehearsal-20260910`, revision 76, paused. Both saved files retained their exact pre-deployment hashes. Davy's gateway and music connection were not restarted by this work. Davy's running process still has its prior loaded presentation/AI modules; changing source files is not a live gateway deployment.

## Screenshot party implementation

The local AI factory now selects `createVisualParty`. It checks the private screenshot capability before acquiring campaign leases; it has no text-only fallback.

Each of the three logical AI characters receives a separate disposable browser with no network, host mounts, shared cookies or human OAuth session. Its requests are intercepted through the same Activity runtime and bound to that character. Models receive flattened screenshot pixels, ordinary play instructions and at most eight of that character's own recent UI interactions. Controller projections, receipts, roster checks and evaluator material are not model inputs.

Characters may plan concurrently. Their gameplay submissions are serialized and recheck ownership, the DM gate, the per-character limit and the total action budget. Each decision opportunity allows at most one committed action per character and at most three total. Repeated interactions, failed inference, unknown receipts and pending rulings stop the opportunity. Late inference cannot click into a later opportunity; new work waits while prior inference drains.

Before dispatch, the controller atomically records only the command ID, campaign, actor and expected revision. It also persists the decision opportunity ID before starting work, so restarting cannot grant the same opportunity again. A scoped, exact committed receipt is required to clear an uncertain action. A missing receipt never authorizes a fresh replacement command. The journal keeps up to 4,096 opportunity identities, then fails closed rather than silently forgetting replay protection. Screenshots and model histories are not persisted in this journal.

The 120-second decision timer bounds inference and interaction work. Initial readiness, recovery and journal I/O also depend on their individual transport/filesystem bounds. Unknown outcome records remain until proven recovery; they must not be manually deleted to force play.

## Evidence and limits

- Eight controller/recovery tests pass, covering parallel planning, serialized budgets, DM pause, ownership replacement, late inference, persisted opportunity replay and recovery across controller restart.
- The browser boundary's thirteen-test opt-in run passes, including a real isolated Chromium container rendering the compiled Activity. It also verifies replacing prefilled fields and refusing non-editable targets. This uses synthetic identity and copied Unity projections; it is not Discord or blind-player evidence.
- Five private vision transport tests pass. Existing AI/art lifecycle tests pass with the new integration. These test fixtures do not call a live model.
- The standalone authored-terrain Unity probe passes its fresh-campaign opt-in, selected-square action, resource spending, replay and process-restart checks. It uses disposable state.
- Desktop and phone screenshots of all three map levels and expanded maps exist under `LocalFiles/hollow-lantern/scene-design-20260910/browser-preview`. They are simulated API presentation evidence.
- The final release passed 59 combined authentication/Activity runtime tests and the production build. Root verified eight local/public HTTP cases after reload; an independent checker verified all 20 served JavaScript assets, all five new caller diagnostic codes and private image/map rejection. The earlier 25-case HTTP run is separately retained and is not added to this count. Actual human Activity authorization, visible authorized gameplay and Discord parity require separate acceptance.

Local evidence:

- `C:/Users/Hermes/LocalFiles/hollow-lantern/scene-design-20260910/web-deployed.json`
- `C:/Users/Hermes/LocalFiles/hollow-lantern/scene-design-20260910/engines-deployed.json`
- `C:/Users/Hermes/LocalFiles/hollow-lantern/scene-design-20260910/engine-checkpoint.json`
- `C:/Users/Hermes/LocalFiles/hollow-lantern/authored-terrain-verification-20260910/report.json`
- `C:/Users/Hermes/LocalFiles/hollow-lantern/activity-auth-diagnostics-20260910/caller-diagnostics-live-verification.json`
- `C:/Users/Hermes/LocalFiles/Obus/vision-activation-20260910/result.json`

Gortex graph checks could not run in this task because its mounted MCP server remains bound to the stale, untracked OneDrive working directory. Source changes and tests used the canonical local project. No graph acceptance is claimed.

## Recovery and service ownership

The current web launcher owns only its web child. Closing launcher terminal 11967 stops that app; it does not stop Unity, Davy or the edge. Start through `raphael-council/hollow-lantern/app-launch.mjs` using the existing protected configuration. It refuses to replace an occupied service. The prior immutable web release and pre-cutover metadata remain retained; do not select restart targets from archived PIDs.

Engine parent PID 36740 / terminal 45899 owns both new Unity children: original PID 42796 on 18791 and rehearsal PID 42512 on 18810. Its `run-engines.mjs` helper under the evidence directory requires the exact matching paused saves, preserves bindings and refuses occupied ports. Closing that parent stops both owned engines. Existing save checkpoints are identified by `engine-checkpoint.json`; never restore over later committed play without checking its revision and preserving that later save.

Davy PID 9068 and private Obus PID 8032 were not replaced. Obus's blocked activation has no approved alternative launch path. Keep journal records and campaign receipts when diagnosing uncertain actions.

## Remaining release gates

1. Resolve the private-worker activation restriction through supported approval review, then verify the installed screenshot capability. Do not substitute another port, worker or direct provider path.
2. Deploy the tested visual controller through the coordinated Davy gateway handoff, with the existing campaign bindings and a recovery checkpoint.
3. Complete actual authorized Activity entry and exercise the visible controls with the enrolled DM account. A recently observed session row alone does not prove that the DM table opened successfully.
4. Run a bounded disposable visual rehearsal, then genuine isolated screenshot-only participant testing and the complete mission/restart/privacy acceptance sequence. Development subagents and synthetic browser tests do not satisfy blind testing.

## Design references

The inventory paging and grouped action choices were informed by [Seven Spells of Destruction's inventory guide](https://www.ssod.org/lore-guide/discord-rpg-bot-inventory). [Avrae](https://avrae.io/) informed rules/resource presentation research. Discord-native cards use the [official component reference](https://docs.discord.com/developers/components/reference); the Activity provides the larger interactive map surface. All approved scene images in this change came from the user's local Stable Diffusion installation.
