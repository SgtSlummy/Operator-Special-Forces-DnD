# Player recovery checkpoint — 2026-09-12

The full implementation plan remains active. This checkpoint completes the human player uncertain-action control slice; it does not certify the full product or a live deployment.

## Implemented

- `engine-client.resolveUncertain` signs `/api/rpg/resolve` requests and validates exact campaign, command, owner, actor and original revision bindings. It accepts only a committed original receipt or a durable cancellation proof. It never resends gameplay on uncertainty.
- Engine recovery responses add outer identity bindings on clones, including replies from older persisted fences. Existing saved fence history is not rewritten merely to add transport fields.
- `service.resolve` checks current campaign access before dispatch and again before returning the result. Human browser requests cannot supply another target owner.
- The authenticated Activity POST `/api/hollow-lantern/resolve` accepts only commandId and expectedRevision; actor and campaign come through the established authenticated route scope. Resolution does not invoke gameplay callbacks.
- The player table now offers **Resolve missing action** separately from read-only receipt recovery. It preserves the saved action's campaign, character and original revision when another campaign is open.
- `clearResolved` validates the complete terminal response and compares the exact saved session-storage record before removal. Network errors, malformed/mismatched responses, storage errors and replacement records retain the pending action.

## Verification

- Full C# runner exited 0 with 178 recovery checks plus existing journal, director and engine suites.
- Actual compiled C# committed, cancelled and old-fence replay responses passed the real Node client validator. Evidence: `C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/resolve-client-wire-0c47bdfa4e484c098fe821c6e3384d7c/client-acceptance.json`.
- Parent independently ran 63 client/service/follower checks, 31 HTTP/service/transient-auth checks and 41 final focused recovery/registry/session checks; each run exited 0. These counts overlap and are not additive unique-test totals.
- Full TypeScript check and production local build exited 0; the build includes the new resolve route.
- Compiled browser rehearsal passed at desktop 1440x1000 and phone 390x844. It sends one original action, simulates an interrupted reply, opens another campaign, retains recovery through a 503, then clears only after a bound cancellation proof. Exactly one gameplay submission and two resolution attempts occurred; the current campaign remained open. No page errors or horizontal overflow. Phone screenshot visually reviewed.
- Browser evidence: `C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/browser-resolution-1789246632488/report.json` with desktop.png and phone.png. Run `.planning/discord-engine-integration/browser-resolution-rehearsal.mjs` from the canonical project root to repeat against a current build. All browser API replies are synthetic and intercepted.
- Gortex detect completed after source edits; it reflects the broad pre-existing dirty tree and omits untracked code. Named service/runtime test mapping and guards completed. Contract returned a broad-change warning; its named covering tests passed. Earlier engine/client contract calls timed out, so those reviews are not claimed complete.

## Remaining work

- Do not infer live Discord/Unity end-to-end acceptance from these synthetic browser and layer tests. No live campaign saves, Discord messages, runtime mode or deployment were changed.
- The isolated AI player browser still has a separate endpoint allowlist/serialized recovery queue. It does not yet expose the new resolution operation.
- The AI director's durable pending journal still needs explicit authorized terminal resolution integration, including human-GM handling after controller retirement.
- WAL full-state retention and per-save chain scans need performance/compaction work before long-running rollout.
- Continue the complete requirement ledger in IMPLEMENTATION.md, including all 45 states, separate play modes, native design/tool integrations, Unity migration and live acceptance. Existing external Figma/Unity blockers are not completion.
- Preserve private Obus-only gameplay, existing hardware/no spending, no new recurring tasks and all project/game data outside OneDrive.

Coordinator claim 23 retains active frontend/runtime/service paths and releases completed C# reservations only; it does not remove source or narrow the goal.
