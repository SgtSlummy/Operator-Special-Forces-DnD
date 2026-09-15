# Supporting full-project review reconciliation

The September 9 sibling [full-project review](C:/Users/Hermes/LocalFiles/Reviews/20260909-full-dnd-review/FULL_REVIEW.md) is supporting evidence for the existing implementation. Its FAIL verdict and 15 findings remain intact. Nine findings were classified as release-blocking functional or authority defects, not nine proven remotely exploitable vulnerabilities. No ownership claim, deployment setting, credential or live campaign was changed by this reconciliation.

## Current applicability

| Findings | Current evidence | Disposition |
| --- | --- | --- |
| F01: Windows protected launcher | The legacy launcher still invokes a `.cmd` shim directly. The deployed Hollow Activity launcher instead starts Node with an argument array and an immutable Vinext build. | Legacy finding remains open; current Hollow launch has separate successful evidence. |
| F02: incomplete asset recovery | The legacy recovery configuration still omits generated renders and separately configured portraits. Hollow's deployment checkpoint includes its configured campaign-art and runtime-art roots. | Current root coverage does not establish arbitrary relocation or complete legacy recovery. Keep the restore-asset gate open. |
| F03: ComfyUI deadline | The legacy Comfy provider remains unbounded. Hollow uses local SD through Obus, with a bounded client request and socket timeout. | Different active provider path; an absolute server job deadline and cancellation reconciliation remain unproven. A client timeout does not establish that server inference stopped. |
| F04/F05: scene side effects and cancellation | Current legacy host/loader hashes match the reviewed files. Stale/replayed scene-load side effects reproduce. The abandoned activation gate remains a source/API-contract finding; no new Unity cancellation reproduction was performed. | Keep open on the legacy host. Hollow's signed listener dispatches to `LanternAuthority` and `LanternStore`, not `RpgRuntimeHost`. |
| F06: runtime/editor assembly | The runtime `Core.Editor` dependency was removed and Editor-only assembly definitions were added after the reviewed snapshot. The shipped Hollow Windows player build reports success. An unused `UnityEditor` import remains outside this task's claims. | Player-build gap superseded for the shipped artifact; source hygiene and broader legacy scene acceptance are not declared complete. |
| F07/F08: mutable receipts and duplicate bootstrap | The unchanged legacy receipt mutation reproduces; legacy bootstrap cleanup remains unchanged. | Open legacy findings. Hollow has its own cloned receipt/state boundary and bootstrap. No global fix is claimed. |
| F09/F10/F11: turn bypass, minted loot, party reload | Fresh archived probes against the current legacy test assembly reproduce all three. Hollow uses active-turn/map/resource checks, finite source quantities and no player-controlled campaign reload. | Distinguish legacy failures from the newer live authority; preserve both sets of evidence. |
| F12: dependency advisories | Reviewed dependency pins remain unchanged. This reconciliation did not rerun the registry audit or establish reachability. | Open release gate; do not equate a successful production build with an advisory-free dependency set. |
| F13: repeated Discord lookups | The membership/guild/roles lookup cost remains. Hollow's current table has no periodic polling loop matching the older two-second cadence. | Performance concern remains qualified; preserve fresh authorization when optimizing. |
| F14: full-history Chronicle scan | Generic Chronicle still loads shared history before slicing a page. | Open in the Chronicle implementation; no throughput claim or unrelated edit. |
| F15: provider provenance | Generic image service still labels non-library output as OpenAI. Hollow SD receipts record the local provider, model hash and `cloud:false`. | Generic metadata defect remains open; current Hollow receipts provide distinct provenance. |

Detailed evidence: [engine reconciliation](C:/Users/Hermes/LocalFiles/hollow-lantern/review-reconciliation/engine.md), [app reconciliation](C:/Users/Hermes/LocalFiles/hollow-lantern/review-reconciliation/app-presentation.md), and their adjacent source-hash and probe logs. Current source hashes are compared with the review inventory; a changed hash alone is not treated as a repair.

## Fresh checks and owned correction

The two reported AI contract expectations still fail: the host control now exposes `release` and `syncEvidence` in addition to the older five expected methods; ineligible external processing reports `unavailable`, while the old expectation is `unknown`. The targeted run had four passes and two failures. These test files were left untouched because they are outside the retained claims.

A fresh full type check also found eleven unknown-response diagnostics in the owned Hollow Activity page. Explicit response types now describe the existing HTTP contract, retaining the existing status checks and runtime receipt validation. Rechecking leaves the original nine diagnostics in the two lab pages and none in Hollow Lantern. This was a type-only source correction; it did not alter the running application or gameplay behavior. The full type check still fails.

Evidence: [contract failures](C:/Users/Hermes/LocalFiles/hollow-lantern/review-reconciliation/current-contract-tests.log), [type check after the owned correction](C:/Users/Hermes/LocalFiles/hollow-lantern/review-reconciliation/typecheck-after-owned-fix.log), and [successful standalone build log](C:/Users/Hermes/LocalFiles/hollow-lantern/unity-public-outcomes-build.log). The build log records `Build Finished, Result: Success.` and the player output at `C:/Users/Hermes/LocalFiles/HollowLanternUnity-PublicOutcomes/HollowLantern.exe`.

The earlier 673-test result, the review's 1,613 passes, and current focused suites overlap. They must not be added into a unique total. Lint and dependency audit remain non-green gates from the sibling review; neither was silently superseded by a focused pass.

The reported four-check MemPalace integer-score repair belongs to its existing owner. It was accepted as support evidence and not duplicated. No claim of live Obus activation follows from it. The previously rejected private-worker restart and the pending OAuth credential approval remain unchanged.
