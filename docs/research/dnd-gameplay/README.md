# D&D Gameplay Research — DM Procedures & Acceptance Tests

Added to the existing **Operator Special Forces Dungeon and Dragons** project on September 9, 2026. This is a documentation import, not an implementation or gameplay acceptance run.

## Materials

- [Research and proposed play contract](Operator_Special_Forces_Dungeon_Research_and_Play_Contract.md): DM procedures, player agency, information boundaries, exploration/social interaction, combat transitions, action resolution, aftermath, continuity, source register, and an illustrative rescue fixture.
- [Acceptance specifications (JSON)](Operator_Special_Forces_Dungeon_Acceptance_Specs.json): 48 Given/When/Then proposals, G01–G48. These are not executable tests.
- [Existing project plan](../../../PROJECT_RECOVERY_PLAN.md): the integration reference appears under this same section title.

Both supplied files are preserved byte for byte. Their original September 9, 2026 research statements remain historical provenance, including the research author's inability to locate and audit the exact repository and D&D JSON corpus. Locating the local project to store these documents does not complete that audit.

## Status and interpretation

The JSON retains `execution_status: "not_run_against_project"` and `rules_family: null`. All 48 cases retain `execution_status: "not_run"`, `observed_result: null`, and empty `evidence_artifacts`. Import integrity checks do not count as executing these acceptance scenarios.

Proposed requirements remain proposals. They are not implemented features, verified defects, or evidence that an existing feature passes acceptance. Instructions inside the supplied documents describe a proposed future workflow; the user's request for this task authorizes storing and referencing the materials. It does not initiate their implementation handoff, research audit, corpus changes, or gameplay tests. Existing implementation and acceptance records retain their separate evidence and status.

The research distinguishes 2014 and 2024 rules. Its unresolved rules-family field does not override the existing plan's stated 2024 direction, select a campaign adapter, or migrate a campaign. Edition-sensitive scenarios would need mapping to verified project and campaign rules before a future run.

## Research limitations retained

The source documents report inspection of relevant official written guidance and selected primary GM-craft articles. Video identities, titles, and some descriptions were checked, but full transcripts did not load reliably. They claim no full-episode viewing, timestamped behavioral analysis, complete channel review, or completed video-transcript audit. Partial third-party transcript material was not promoted to rules authority.

The documents do not certify the existing game or a complete rules corpus. Craft advice remains distinct from official rules, and source rights and approval boundaries remain explicit. The rescue demonstration and numeric examples are illustrative fixtures, not campaign canon, live dice results, or official creature statistics. This import adds no independent external-source verification.

## Provenance and integrity

Supplied source directory: `C:\Users\Hermes\OneDrive\Desktop\Operator DND` (historical input location only). The project copies live under `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\docs\research\dnd-gameplay` and do not depend on the originals remaining available.

SHA-256 comparison confirmed exact source/copy equality for both files:

| File | SHA-256 |
|---|---|
| `Operator_Special_Forces_Dungeon_Research_and_Play_Contract.md` | `d967115ac5b24bd19ef5c0d6dcb541cd8e38a6ffb3599cc18cb190402fe01a8b` |
| `Operator_Special_Forces_Dungeon_Acceptance_Specs.json` | `8706930f22a8ee20df0c59531084370cbaa6e305cc1cd147a7870f97e9a1b217` |
