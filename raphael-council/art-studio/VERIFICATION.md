# ComfyUI integration verification

Verified locally on September 12, 2026 (September 13 UTC), in the canonical Projects folder.

## Runtime and real output

The studio listened on 127.0.0.1:51960, ComfyUI on 8188, and the existing isolated table on 51950/51951. The renderer reported an NVIDIA RTX 3090 and an empty queue after verification. Runtime: ComfyUI 0.34.0 / frontend 1.51.10 / Python 3.13.15 / PyTorch 2.14.0+cu130. It used the previously installed v1-5-pruned-emaonly checkpoint through the shared model-path config.

Five actual jobs completed through the browser creation form, with PNGs and full records under data:

| Kind | Title | Job ID |
| --- | --- | --- |
| Location | An evening at the Salt Lantern | b3209840-0d09-4b4b-9ca3-48f076d225a6 |
| Location from game | The Salt Lantern | 6c9b3f63-f1ad-401a-bf28-5c04892b3e94 |
| Character | A keeper of the coast | 4fd07c96-e5f1-455c-be8e-64089fddd93a |
| Item | The mariner’s compass | 155d2932-a173-48e4-9ed4-fde32bba8b6e |
| Map illustration | A harbor inn from above | b69247fd-14c0-4f0c-822e-da2cbfdb0547 |

The first location completed in 13.40 seconds according to the renderer log. Output files were viewed directly or in the live collection. These are generated artwork, not claims of exact scene reproduction. The map preset produced an illustrative interior, not a coordinate-accurate tactical map.

## Exercised browser behavior

- Form submission, kind selection, example briefs, queue/running/ready states, gallery selection, and all four kinds.
- Workflow tab loaded the real ComfyUI frontend. Ctrl+O imported the first image's downloaded API workflow; the exact prompt and linked graph appeared.
- Game's Illustrate this scene opened an embedded studio with the current projected room description. Use at the table closed the panel and displayed the correct generated PNG as a local preview. Restore campaign art brought back the original image. No campaign-state write or external publication was involved.
- Desktop inspection and 390 x 844 responsive viewport inspection. Final mobile DOM had document clientWidth = scrollWidth = 375 (browser scrollbar accounted for); no page-level horizontal overflow.
- Start-ArtStudio.ps1 successfully found an already running studio, and later launched the studio and renderer after an owned-process restart. Completed art remained available.

The larger Raphael app's Illustrations integration passed TypeScript checking; that app's full page was not separately launched for browser testing.

## Automated checks

Eight studio tests passed: workflow wiring, settings bounds, exact successful history matching, origin/capability/model validation, duplicate submission, concurrent eight-job bound, uncertain submission recovery, and PNG/workflow persistence across restart.

Nine existing table tests passed, including role projection, private rewards, enemy visibility, state actions, Discord payload scoping, and HTTP capability/origin/persistence behavior. Total: 17 passing behavioral tests across these suites. Frontend module syntax checks and `npx tsc --noEmit` also passed.

## Design review and tooling limits

The Impeccable detector ran once on the changed UI targets. Studio status and metadata sizes were raised to 12px; mobile overflow and missing line-break whitespace were corrected. Remaining detector advisories concerned incumbent table color/shadow drift and an inline radius parsing artifact; the pre-existing system was not rewritten.

A separate fresh verifier performed the unavailable named finish-reviewer role using its documented contract and returned **disposition: ship**, with no material fixes. Its scope was the supplied captures and sampled source; generation and game delivery were exercised separately above. The ordinary-extension documentation pass completed with no changes to DESIGN.md or its sidecar. It verified the palette, local font, responsive form/canvas layout, and restrained controls; noted small inherited-system differences are not new global tokens.

Captures are in the gitignored qa folder: desktop.png, mobile.png, collection.png, nodes.png, and game.png. Collection and node captures show the corresponding feature checks; desktop/mobile are the final primary layout captures.

Gortex performed the source mutations but its graph index repeatedly failed to become fresh, reporting pending/failed mutation receipts across this workspace. Impact and post-change detection could not certify the graph; no changed symbol IDs were returned for graph test/guard/contract checks. Direct source tests, TypeScript, and browser evidence above provide the executed verification. No Gortex static-analysis clearance is claimed.

The upstream ComfyUI frontend logged an early initialization error and transient queue/history fetch errors during the intentional local renderer restart; it reconnected and successfully imported the saved workflow afterward. No studio application errors were observed after the final reload.
