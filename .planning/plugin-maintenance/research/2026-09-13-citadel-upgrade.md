# Citadel 1.3.5 → 1.3.7: Windows and Codex upgrade assessment

Research ID: RES-CITADEL-20260913. Evidence reviewed: 2026-09-13 UTC. Project: `C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons`. This is a completed research assessment and reviewable execution plan; no upgrade, archive installation, live hook test, service restart, or rollback was performed.

## Recommendation

Prefer a pinned native Codex marketplace upgrade to Citadel 1.3.7 when it can be loaded without disturbing existing tasks. Keep the currently valid 1.3.5 configuration until then. The expected benefit is preventing another invalid trust-counter write and improving Windows hook and project-upgrade compatibility. This is a targeted reliability recommendation, not a claim of faster models, lower subscription spending, or better game output.

Citadel 1.3.7 is a published September 10, 2026 release at commit `3673927`; its immediate release change is the upgrade/audit repair in PR #280. The preceding 1.3.6 release includes the trust-counter and Codex integration fixes. Thus 1.3.7 is a more useful endpoint than stopping at 1.3.6. These are release records, not local execution results. [1.3.7 release](https://github.com/SethGammon/Citadel/releases/tag/v1.3.7), [1.3.6 release](https://github.com/SethGammon/Citadel/releases/tag/v1.3.6).

The upgrade remains staged as a plan because the installed plugin is shared with active tasks. Its registration, loaded version, native hook trust, and rollback all require their own evidence. A configuration gate passing on 1.3.5 does not establish those properties for 1.3.7.

## Local baseline and applicability

The following observations came from this maintenance pass, approximately 07:24–07:31 UTC. Historical evidence is identified separately in [LOOP.md](../LOOP.md).

| Question | Observed evidence | Consequence |
|---|---|---|
| Which project is real? | Canonical local directory exists; `git rev-parse --show-toplevel` returns that directory. | Use it explicitly; the saved OneDrive task folder is unsuitable. |
| Which Citadel is installed? | Native `codex plugin list --json`: `citadel@citadel-local`, version 1.3.5, installed and enabled. | The candidate has not been installed or loaded. |
| Where does it come from? | Native marketplace listing identifies a Git source at `https://github.com/SethGammon/Citadel.git` and a managed temporary snapshot. | Use the existing marketplace identity. The listing does not prove its current ref is pinned. |
| Does the present config work? | Installed 1.3.5 `citadel-config.js check route verify --runtime codex --json` and the corresponding `research` check exit 0: effective state current, route enabled, errors empty. | No repeat config mutation is warranted this pass. These checks do not execute all hooks. |
| Is the Node major suitable? | Local Node reports v24.19.0. | It matches the documented Node 22/24 release test majors; exact local compatibility still needs validation. |
| Is file ownership clear? | Coordinator schema 2 marker is enabled; the narrow `.planning/plugin-maintenance` claim was accepted without warnings. | Only this report/checkpoint belongs to this pass. |
| Is monitoring fresh? | Gortex report observed 07:12:51Z; Chronos evaluation independently observed 07:28:54Z, cycle 319 after one owner handoff. | Monitoring exists, with explicit coverage limits. It is not continuous execution while the host cannot run. |

The saved baseline records the earlier invalid `trust.sessions_completed: 1` field and its supported migration preview. Removing that unsupported field and regenerating the effective receipt restored validation. The valid camelCase fields were preserved. No historical activity counter is reconstructed from that fact alone: the exact originating live hook and any lost activity have not been established.

The prerequisite documentation calls for Node.js 22 or newer and a Git repository. The recommended Codex install uses a named release ref followed by native plugin installation; a fresh task and platform hook review are part of loading it. The current machine satisfies the observed basic prerequisites, but no claim is made about an unobserved future task. [Tagged README](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/README.md).

## What fixes the recurring failure?

The tagged 1.3.5 session-end implementation reads `.claude/harness.json`, increments `sessions_completed`, and writes the configuration back. That writer does not choose camelCase based on schema version. This gives a concrete mechanism that could recreate the local validator error after a successful cleanup. Source correspondence is strong; a trace proving that this exact implementation ran in this project is still missing. [1.3.5 session-end source](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.5/hooks_src/session-end.js).

The tagged 1.3.7 implementation detects schema version 2, reconciles five legacy counters into their canonical counterparts, normalizes the trust object, and uses schema-appropriate keys for subsequent increments. Legacy nonnegative integer activity is added before the old aliases disappear. This is more complete than repeatedly deleting a field: it addresses the writer and preserves recognized activity during reconciliation. It does not justify manually increasing local trust values. [1.3.7 session-end source](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/hooks_src/session-end.js).

PR #276 contains both the initial change and a follow-up prompted by counter-loss review. The maintainer reports checking five counters across two sessions, retaining existing activity without counting it twice, and passing 97 hook checks. Earlier PR text also discloses unrelated suite failures. These are upstream results, and their scope is narrower than successful execution inside this particular Codex installation. The local acceptance gate should therefore include two session completions, not merely successful JSON parsing immediately after installation. [Trust-counter repair and review](https://github.com/SethGammon/Citadel/pull/276).

Inference: an upgrade that changes only the installed version label while a task or project delegate still executes 1.3.5 can leave the failure mechanism intact. Loaded hook location and post-session configuration are therefore necessary evidence. This inference connects the observed old writer to the documented loading boundary; it is not a measured frequency of recurrence.

## Windows, Codex, and upgrade compatibility

PR #275 changes Windows plugin-root resolution, Codex-native denial payloads, and PostCompact output projection. The maintainer reports checking path expansion and denial handling in PowerShell and cmd. These directly match the operating system and shell family in use here. A passing route gate does not exercise any of those adapter boundaries; a safe disposable hook fixture should. [Windows hook contract repair](https://github.com/SethGammon/Citadel/pull/275).

PR #271 addresses bundled MCP entrypoints, standard MCP metadata, native hook output envelopes, and the Codex SessionEnd time limit. It merged on August 27; its inclusion in the September 10 release should not be confused with its merge date. Its relevance is compatibility between Citadel output and Codex input, not a need to reconfigure the user's Gortex server or Chronos collector. [Codex integration repair](https://github.com/SethGammon/Citadel/pull/271).

PR #280 fixes initialization invoking an old project delegate before refreshing the plugin location and restores an omitted read-only health diagnostic. Its added checks cover old project state, moved plugin roots, ES-module hosts, release consistency, and packaging. This matters because the current installation has an older versioned cache and generated project state. It strengthens the case for 1.3.7, while leaving actual refresh behavior on this machine to be checked. [Upgrade repair](https://github.com/SethGammon/Citadel/pull/280).

The release changelog also describes preserved permission defaults, bounded daemon/schedule behavior, revocable new schedules, and rejection of a hook-trust bypass option. Existing OS jobs can retain previously stored commands after an update. This maintenance arrangement uses existing native Codex automations; it should not create a Citadel OS daemon or reinterpret this release as authority to change security settings or other owners' schedules. Any separately discovered legacy Citadel OS job needs its own exact inventory and migration decision. [Tagged changelog](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/CHANGELOG.md).

## Alternatives and expected effort

These effort ranges are planning estimates for hands-on validation, not measured runtimes or promises. Shared-host availability can dominate elapsed time.

| Rank | Option | Expected benefit | Estimated effort | Principal limitation |
|---|---|---|---|---|
| 1 | Pin and install 1.3.7 through the existing native marketplace in an appropriate window | Addresses the writer and relevant adapter/upgrade defects | 45–90 minutes plus two controlled session completions | Must verify actual loaded code and preserve active users of the plugin |
| 2 | Continue current valid 1.3.5 and compact monitoring temporarily | Avoids disruption while work is active | 5–10 minutes per exceptional check | Old writer can still recreate the schema fault; not a durable fix |
| 3 | Use a verified standalone 1.3.7 archive and governed adoption for a separate explicit installation | Strong artifact identity and reviewable lifecycle | 1–2 hours plus receipt/ownership review | Different ownership model; not a drop-in edit to the managed cache |
| 4 | Carry a local backport in the live cache | Could change the offending writer | Uncertain; likely greater long-term maintenance | Cache replacement, version drift, shared impact, and incomplete companion fixes make it unsuitable here |

Option 2 is the present holding state, not a reason to abandon option 1. Option 3 is justified only by a specific need for a standalone/offline installation. Option 4 should not be adopted under this loop. No new model, provider, game engine version, or retrieval package is needed to fix this counter defect.

## Concrete execution plan

### Preparation and review boundary

Before an installation, recheck the native inventory and the currently loaded package path. Capture the old marketplace identity, release ref if exposed, version, and exact project state pre-images. Keep task-owned backup material beneath `C:/Users/Hermes/LocalFiles`; do not copy credentials, entire Codex databases, game stores, or unrelated caches into a report bundle. Check Coordinator ownership again because today's accepted claim expires when this pass ends.

Choose a time when loading the new version does not interrupt existing tasks. This is a user-owned no-interference requirement, not a claim that every installation always needs a global restart. A fresh task may be enough according to the release documentation; require host evidence instead of forcing a restart or assuming hot reload.

### Native marketplace path

The following are reviewable candidate commands, not commands executed by this report:

```powershell
Set-Location -LiteralPath 'C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons'
codex plugin marketplace add SethGammon/Citadel --ref v1.3.7
codex plugin add citadel@citadel-local
```

The native CLI help on this host confirms `add --ref`, `plugin add`, and a separately named marketplace refresh command. Its listing already identifies `citadel-local`; repeat-add conflict behavior and the exact mutation footprint were not exercised. Stop on a real identity conflict and inspect the returned result. Do not remove the existing source as an improvised retry. Do not issue an unscoped marketplace upgrade, which this CLI documents as refreshing every configured Git marketplace. The install syntax is also documented in the [tagged installation guide](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/INSTALL.md).

Once native registration succeeds, inspect the installed version, the loaded path in a permitted fresh task, and the platform's hook-review state. Preserve the project's selected bundles and any existing explicit degraded-runtime choice. Re-run the version's supported config checks. If it proposes a migration, compare the exact candidate before applying; do not rerun setup to overwrite an already configured project.

### Standalone archive path, only if deliberately selected

The release contract defines an archive, external manifest, and checksum sidecar plus GitHub build attestations. Integrity agreement alone does not authenticate the publisher. All expected version/ref, digest, source-commit, and provenance checks should pass before executing a staged archive. No archive or attestation was downloaded or verified in this pass. [Release verification contract](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/docs/RELEASES.md).

A standalone installation updater targets the Citadel installation, not the DND project or a Codex-managed cache. It plans before apply, keeps a backup, and validates the backup's binding during rollback. A governed project update is a different lifecycle using saved plans, receipt ownership, compatible migrations, and retained predecessors. Do not substitute one target or ownership model for the other. [Release updater boundary](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/docs/RELEASES.md), [governed CLI contract](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/docs/CLI.md).

One subtle verification trap appears in the tagged Codex installer: dry-run steps can report `pass: true` while also being explicitly skipped. Its normal preparation can regenerate package-side artifacts, and project readiness work depends on the selected mode. Therefore a dry-run is a command preview, not a Windows readiness pass or proof of hook execution. Inspect the structured skipped/executed fields and validate the actual selected path. [Tagged Codex installer](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/scripts/codex-install.js).

## Acceptance checks and rollback

Use the following checks in a later authorized installation. They are proposed tests; this report did not run them against 1.3.7.

| Gate | Required evidence | Stop or rollback trigger |
|---|---|---|
| Identity | Published exact release; native installed version and loaded root agree | Floating ref, wrong source, mixed versions, missing artifact verification where archive path is used |
| Existing state | Current effective receipt; verify/research gates enabled; selected bundles and authority unchanged | Unknown fields, stale receipt, unintended authority/profile change |
| Counter regression | In a disposable fixture, preserve nonzero canonical and valid legacy values across two session endings; no recreated legacy v2 keys | Lost activity, double accumulation of legacy aliases, malformed config |
| Native adapter | Safe fixture verifies quoted Windows paths, structured denial, and hook context envelopes | A supposed block is ignored or output is misinterpreted |
| Project upgrade | Older generated delegates resolve to the new supported root; read-only health is available | Old delegate still executes, root drift, or unrelated file mutation |
| Coexistence | Existing schedules and Coordinator claims survive; Gortex tools remain available; Chronos data stays provenance-labelled | Duplicate schedules, owner collisions, shared service disruption, fabricated fresh evidence |
| Recovery | Exact predecessor and configuration pre-images retained and usable | Unbound backup, changed shared file, missing ownership receipt |

Counter fixtures should use synthetic activity, not real trust escalation. Native denial fixtures should exercise harmless disposable content, not modify approval rules. Full maintainer suites belong in an isolated source checkout if they are necessary; the slim release excludes test programs. Upstream suite counts are not evidence that a production game test or all Codex hooks have run locally. [Release contents](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/docs/RELEASES.md).

For the preferred marketplace path, retain the prior 1.3.5 package and exact pre-change registration evidence. A rollback candidate re-pins the same official marketplace to the previous published release and reinstalls through the native manager, then verifies a newly loaded task. This is a proposed recovery procedure, not an exercised rollback guarantee; native handling of a pre-existing source must be checked. Restore only an exact, unchanged owned pre-image through the applicable guarded workflow. If other tasks have changed a shared file, stop for reconciliation rather than overwrite their work.

Governed adoption needs its own receipt-backed rollback plan. An installation lacking such ownership evidence cannot claim exact removal or restoration merely because a backup folder exists. Saved lifecycle plans belong outside the target so they do not change their own preflight snapshot. [Governed installation and rollback](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/INSTALL.md), [CLI ownership checks](https://raw.githubusercontent.com/SethGammon/Citadel/v1.3.7/docs/CLI.md).

## Risks, uncertainty, and next decision

Confidence is high that the tagged source fixes the identified schema-writing mechanism and that the native CLI exposes the documented acquisition syntax. Confidence is moderate in project applicability because the symptoms, OS, Node major, and older generated state align. The exact live historical writer, current marketplace ref, candidate archive provenance, actual 1.3.7 hook execution, and native rollback behavior remain unverified.

The practical next decision is to schedule the prepared native upgrade when active tasks can be preserved, then require the acceptance evidence above. Until that point, the six-hour maintenance loop should recheck the current config and route new failures to the existing owners. A repeated counter error should produce a bounded, evidence-backed repair decision; it should not create an endless deletion loop or silently modify plugin security.

After this focused report, the next research question is whether Gortex 0.64.3 addresses the observed committed-edit/graph-refresh ambiguity on this Windows installation. The monitor's successful stale-registration repair is already a separate verified recovery; it should not be attributed to an uninstalled Gortex upgrade. DND/Unity/Discord and retrieval improvements remain in the ranked project backlog rather than being bundled into this Citadel installation.

Research completion means the question, alternatives, evidence, compatibility, effort, validation, and rollback plan are documented. It does not mean the proposed upgrade is complete. The broad five-plugin release scan retains its previous completion time because its 24-hour interval was not due during this focused investigation.
