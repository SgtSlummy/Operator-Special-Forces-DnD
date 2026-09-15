# Isolated interactive rehearsal

Status: one isolated local web movement and own-token identification slice **passed** after fixing the private map. Full mission, Discord and Activity acceptance remain separate.

`hollow-lantern/isolated-interactive-rehearsal.mjs` provides a disposable Chromium transport, independent visual participant relay, bounded controller, and evidence writer. Two control/isolation tests pass. The local installed browser image is `localhost/hollow-browser:isolated` (Chromium and playwright-core on the existing Node24 Debian image). It is a development dependency, not a game service.

The browser runs read-only with no network, no host mounts, dropped capabilities, no-new-privileges, bounded memory/processes, and a fresh temporary profile. Chromium's internal sandbox is disabled inside this outer container. Its request interception forwards HTTP through the trusted controller only to `http://127.0.0.1:18795`; no other origin is allowed. Cookies enter through the ordinary single-use login flow and remain in the isolated browser profile. They are never supplied to the model. A separate read-only network-none Node relay receives only the screenshot, ordinary task, and that participant's own actions. The trusted transport calls the fixed local Ollama model with no tools/retrieval/shared history. This is not a Codex development agent posing as a blind tester.

Actions are restricted to pixel clicks, typing, scrolling, and done/uncertain observations. No selectors, DOM, script execution, arbitrary URLs, source, GM state, or controller judgments are accepted from the participant. The trial is capped at ten actions and ninety seconds. Controller audit callbacks independently read fixture commits, detect rulings/disclosure/uncertain outcomes, and evaluate final results. These callbacks must be connected to the **current** fixture save before acceptance; a manual-required verdict must never be treated as a pass.

Actual attempts on 2026-09-09:

- `LocalFiles/hollow-lantern/validation/interactive-15e69304-7efd-4db9-ab9a-39b9129ff6d3`: screenshot showed expired login from an obsolete fixture path. No action submitted.
- `interactive-007ae631-81b8-46bf-abb6-4b0cd1b22032`: same expired old-path login. No action submitted.
- `interactive-ed9370bf-dcb5-4257-88f0-83b962c78650`: corrected current fixture link, initial loading screenshot captured; visual inference timed out. No action submitted. Startup now waits briefly for ordinary page loading before capture.

The local model did not return within its eighty-second bound. An independent twenty-second text-only inference also timed out. Repeated attempts stopped; no service restart or model changes were made. PNGs, browser isolation inspection, and reports are preserved, including failures. These are disposable local web screenshots, not Discord screenshots, and prove neither successful movement nor full mission readiness.

For the next attempt, obtain a newly minted player link from `C:/Users/Hermes/LocalFiles/HollowLanternUI-20260909/web-fixture-links.json` (sixty-second lifetime). The correct controller save is the adjacent `campaign.json`, engine18794; the older `unity-supervised-20260909` link file is obsolete. Verify local vision inference is responsive before consuming a fresh link. Connect audit callbacks, run one trial, inspect committed move receipt and before/after token coordinates, and preserve the result regardless of success. Never point this harness at the live campaign.

## Follow-up with responsive local vision

Provider diagnosis restored responsiveness with per-request `num_ctx:4096` and the idle SD checkpoint unloaded. The harness now uses that bounded context, an ordinary-action output schema, explicit normalized click coordinates scaled to browser pixels, network-idle startup, and a stop after three repeated unchanged choices. These settings calibrate the input/output protocol; they do not supply a correct action or expected result.

- `interactive-a2ecdf06-59f6-4bb3-9eb8-0d78aa0d6348`: model responded and attempted ten clicks, but the earlier coordinate convention missed the button. No commit. Both browser and participant container inspections are retained.
- `interactive-962e6097-d456-42cb-9115-0feb35b4c251`: actual model-selected pixel click activated the ordinary Confirm button. Unity committed revision3→4, Mara displayed coordinate4,4→4,3. Before/after screenshots and `committed-receipt.json` are retained. The model's final response omitted its required visual observation, so the trial remained failed rather than being counted as visual-comprehension success.
- `interactive-fd77ea80-c2e1-4901-8a2a-d9670a164189`: stopped before a click because the response exceeded the allowed action schema. No additional commit. Provider-side JSON schema was then added to enforce ordinary control formatting.

Successful independent visual description of the movement remains required. The demonstrated committed click is a narrow interaction proof, not full isolated human-player acceptance or an actual Discord session.

Final schema-bound trial `interactive-e9f06516-3fe2-4123-ab63-667c5fbe601a` committed a valid move at revision5 in 8.7 seconds. The participant correctly read the receipt, but identified a companion at column5,row4 as its token; Mara was at column4,row2. Therefore it **failed own-token visual understanding**. The initial permissive evaluator incorrectly accepted the word “moved”; independent review corrected the report, preserving the initial verdict separately. `evaluateTokenObservation` and its regression test now reject receipt-only descriptions and incorrect companion coordinates. Use that controller check for the next trial. All outcomes and failures remain separate; do not collapse them into a passing walkthrough.

## Passed focused retest after own-token presentation fix

Private maps now carry the trusted character scope into rendering. A top `YOU · name · Column X, row Y` legend and cyan diamond/border distinguish the viewer from gold companions; all marking stays inside the visible square. GM views remain neutral, and hidden tokens cannot trigger a header or image load. Nineteen focused renderer/adapter tests passed, including scoped color and hidden-pixel privacy checks.

Fresh isolated retest `interactive-c867842a-abd4-4faf-a979-fca4f3e80e87` took 27.75 seconds. The participant received the ordinary task and screenshots only, clicked Confirm once, and Unity committed Move revision5→6, Mara displayed4,2→5,2. Its final observation correctly identified Mara at column5,row2 and the revision6 move outcome. The strict controller check and independent image/receipt review agreed. Files include two screenshots, model control outputs, both container inspections, `controller-verdict.json`, `committed-receipt.json`, and `report.json`. Containers closed afterward. The participant received no expected coordinate, test rubric, engine save, GM material, or peer history.

This establishes one fresh simulated participant's ability to operate this local web movement control and identify its character in the resulting rendered view. It does not prove every character, every phase, mobile usability, Discord SDK authentication, or the complete mission. Earlier failed trials remain retained as failures.


## Independent character-panel and DM-panel expansion

All following evidence folders are beneath C:/Users/Hermes/LocalFiles/hollow-lantern/validation. Each participant used a fresh browser/profile and separate stateless model context. The panel browser proxy additionally rejects every non-login write request. No inventory action, ruling, or other campaign mutation was permitted. The disposable fixture remained at revision6.

- Rogue initial panels-a23146c8-52c3-4baf-90e4-0321d0a53bde and cleric initial panels-9814dfaa-831b-48f8-aec9-6a9e4849a323 identified their own displayed coordinates, but failed subsequent navigation; both remain PARTICIPANT_UNCERTAIN. Some other map descriptions were inaccurate, so these are not comprehensive map-perception passes.
- Rogue panels-f65c7b00-9cdc-4191-9c70-c52d319ebd13 repeatedly selected a static label and stopped REPEATED_NO_CHANGE. The navigation label now explicitly lists Map, Character, Inventory, and current-task framing prevents prior observations from answering a new task.
- Rogue panels-b34044c1-2b9a-493b-ae74-7f000c6fbc5e passed Character and Inventory navigation in18.561 seconds. Independent screenshot review confirmed the observed rogue sheet, Sneak Attack explanation and visible inventory quantities/descriptions.
- Cleric panels-1edd2482-ed56-4e6d-acef-886eb856d33f passed the same navigation in20.791 seconds. Independent screenshot review confirmed the cleric identity, Sacred Flame explanation and visible equipped mace/inventory details.
- DM panels-8dcc44c5-3990-4be3-bdc5-eb9c9598dfd4 failed to establish status/review understanding. The UI now explicitly states Player decisions OPEN or PAUSED, the pending-rulings count, and offers Review navigation. DM panels-cc14c850-3f96-4875-a148-fc46b8cde4f9 passed status/control identification only; it did not navigate.
- DM panels-a811d6c9-8d4d-4f84-8eb1-f539c9add86f clicked Review successfully but repeated that control and hit the action cap. This remains failed. The empty Review page now hides the redundant Review control and unrelated GM checks, showing No pending rulings and Back to map.
- Fresh DM panels-c131913a-810e-4a9f-b6a6-a1bfaaed1c1c passed in9.263 seconds: one ordinary Review click, followed by an accurate screenshot description of the open Pending rulings page, OPEN decision status, zero pending count and empty-state message. Independent inspection of02.png verified the claim. No ruling was created or resolved.

Accepted panel folders include independent-review.json; every failed attempt is preserved. All isolated containers closed and no participant inference remained in flight at completion. Five scoped harness/fixture tests and21 final service/web/action-session regression tests passed. These results cover desktop local-web slices with real local vision inference. They do not establish mobile, real Discord/Activity, full mission, or populated-ruling acceptance. The latest equivalent Activity UI edits require the parent-coordinated production build; no build was run against the active server's output directory.

## Populated ruling trial

Fresh isolated DM trial panels-3b61b59e-e275-4188-91fa-15ab5f0700f0 failed the complete response-choice understanding gate in31.714 seconds. Controller preparation used the ordinary Mara Describe intention in the disposable fixture, preserving revision6 history and producing revision7 with one pending convoy-ledger request. Setup receipt is stored separately in populated-ruling-setup-1788997172267/controller.json and never entered participant context. The read-only participant clicked Review, correctly read the full request and visible Approve/Confirm control, but did not open the dropdown or identify the Decline alternative. Independent screenshot review agreed with the failed verdict. No response was submitted; fixture remains revision7 with the request pending. Both containers closed. No GPU settings, SD availability, live state or application source were changed. This identifies a response-option discoverability gap, not a passed populated-ruling interaction.

### Response guidance retest

Added neutral Approve-or-Decline guidance beside grouped ruling controls in local web and Activity table source, preserving dropdowns and confirmation. Five existing authorization/recovery tests pass; web syntax and TSX transpilation checks pass. Fresh isolated retest panels-e779cf62-8464-4a5d-8376-62edb03c1d77 still failed in13.805 seconds: it read the request and Approve control but omitted Decline despite the rendered instruction. Independent02.png review confirms the new guidance was visible. Prior failure remains intact; no claim that this usability gate is now passed. No response was committed and no service/build/GPU changes were made. Both isolated containers closed.

### Final neutral-selection trial

Pending Review now starts with Choose a ruling response and disabled Confirm until explicit selection; ordinary action defaults remain unchanged. Activity has matching placeholder wording and already required explicit selection. A regression executes the actual browser action-render/selection functions to verify neutral initial state, explicit Decline enablement and preserved normal default. Three focused web tests pass; TSX syntax passes. One final fresh isolated trial panels-41e3aebd-6194-4f37-947e-692c6119ba5b failed in17.170 seconds: the participant read the request and placeholder but did not inspect alternatives. Screenshot02 confirms neutral selection and disabled confirmation, independently reviewed. No more trials were run. All prior failures remain preserved, fixture r7 remains unresolved, and containers closed. This is a verified accidental-default prevention improvement, not a passed blind response-choice gate.
