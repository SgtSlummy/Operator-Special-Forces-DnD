# Undertow Works rehearsal

A local, single-GM exploration rehearsal built from the authored dungeon atlas. It extends the existing room-scale drawing with connected travel, arrival descriptions, optional GM notes, a journey log, and versioned save/restore.

This is not a Unity campaign installation, a multiplayer authority, an automated D&D rules engine, or a public/player-safe projection. Every room and its GM notes are included in the preview source. Do not distribute it as a spoiler-free player handout.

## Run the checks

From the canonical Operator project root:

```powershell
node --test campaigns/the-unwritten-coast/rehearsal/rehearsal.test.mjs
```

Build into the current task's explicitly supplied visualization directory:

```powershell
node campaigns/the-unwritten-coast/rehearsal/build.mjs --out C:\absolute\authorized\visualization-directory\undertow-rehearsal.html
```

Use an absolute output path outside OneDrive. Inline output belongs in the task's supplied visualization directory; merely being readable on disk does not guarantee that the app's inline loader can read it. Render the fragment through the visualize skill when a standalone preview is needed.

## What works

- All 18 rooms and 25 ordinary bidirectional passages come from `../DUNGEON_ATLAS.md`.
- Room dimensions drive the floor drawing, including the 4 × 6 ft Valve Throat, the 1,600 × 900 ft Storm-Lens Cavern, and separate height/depth labels.
- The main investigation route avoids the optional service slot. Both the entry and the signal tower lead to the surface.
- Travel follows actual authored connections. Browsing the atlas does not move the party or mark rooms visited.
- Investigate opens authored GM notes. It does not roll checks, grant items, resolve hazards, or decide a player action.
- Stillwater remains a separately labelled special boundary, governed by the campaign's existing crossing rules.
- Saves include the atlas revision. Incompatible or malformed imports are rejected before replacing the current state. The journey retains its last 20 steps; total passage count is retained.
- Browser storage is optional. Sandboxed inline previews may deny it. Use **Prepare save**, copy the complete text, and use **Restore save** when returning. Starting over requires confirmation.

## Follow-up builds

The [portable pack and player export guide](PORTABLE.md) documents the versioned GM pack and explicit player disclosures. The [isolated Unity adapter check](unity-adapter/README.md) documents the verified Unity 2021.3.14f1 project, current scene-load contract, adapter source, and validation commands.

As of 2026-09-12 UTC, 23 rehearsal/export tests and 17 adapter checks pass. The [full portable-pack fixture](unity-adapter/FULL_PACK_FIXTURE.md) exercises all 18 room envelopes, both directions of all 25 ordinary passages, the optional-slot bypass, the separate Stillwater boundary, and the actual opening player export. The adapter compiles against linked current project contracts on .NET Standard 2.1. It has not been installed or run in Unity, and no Unity scene was loaded. No project upgrade or live game change was made by these campaign passes. The three-run scheduled continuation is now capped and paused; the separate Unity 6 migration remains blocked on intermediate Editor installation.

## Files

- `model.mjs`: atlas parser and pure rehearsal transitions.
- `interface.mjs`: native controls mounted around the existing room drawing.
- `build.mjs`: compiles a self-contained fragment and verifies the written output.
- `rehearsal.test.mjs`: source-content, route, transition, save, and generated-script checks.
- `continuation.json`: bounded continuation state for this user-requested build task, separate from the Coordinator claim board and Chronos supervision.

## Verification and limits

Initial automated verification on 2026-09-11 local time: 13 checks passed. Browser checks exercised all 18 atlas selections, connected travel, investigation, malformed and valid save imports, restart confirmation/cancellation, and return from atlas browsing without moving the party. A visible surface-map defect was found during inspection and corrected before final verification.

The output uses plain text for authored content, escapes embedded data, and makes no network calls. It has no gameplay credentials, authority token, live database connection, or automatic rules rulings. No existing game, cloud service, or deployment was changed.

Unity audio optimization has not been performed. No running Unity Editor was observed during this pass; no clip-import, mixer, or device-build measurements were available. The installed Unity 6 Editor is not evidence that the existing project has been upgraded or validated there.

Citadel daemon activation was refused by its configuration preflight (`trust has unknown fields: sessions_completed`). That configuration and existing task-owned game integration files were preserved. Continuation, if enabled, uses the native Codex task heartbeat, not Citadel's daemon runner. The already existing Chronos Governor and its recurrence remain separate.

Gortex writes were physically verified. Change detection initially encountered pending indexing; a later successful scan reported other tracked changes and omitted these new untracked files. The focused executable checks are the verification evidence, not a claim that graph-wide guards or contracts passed.

Final browser confirmation covered the corrected surface state and 360px/736px layouts. Browser warning/error logs were empty, and the one Impeccable detector pass returned no findings. The generated preview was 43,973 bytes with SHA-256 `5cad1d2919a1ef80b6fd4578f7ca7c9e55641305a52c48f052f55890d9b63393`.

The native heartbeat `the-unwritten-coast-build-passes` was created and its stored settings verified: this task, hourly, three occurrences. Each follow-up is capped at 20 minutes by the continuation contract and must stop or pause on completion, its run limit, or a real blocker.
