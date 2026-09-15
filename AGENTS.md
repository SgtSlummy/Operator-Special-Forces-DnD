<!-- ops-dnd:gortex-exemption:start -->
## OPS DnD development tooling

Gortex is disabled for this project work at the owner's request after repeated MCP failures.
This scoped exception supersedes inherited and local Gortex-only workflow requirements.
Use ordinary file inspection, rg, reviewed patches, Git diffs, compiler diagnostics, and relevant tests.
Do not require Gortex reads, impact checks, edits, indexing, or hooks before authorized work.
Preserve all unrelated instructions, permissions, coordination rules, and local non-OneDrive path requirements.
<!-- ops-dnd:gortex-exemption:end -->

## MemPalace project memory

- MemPalace is this project's agent memory layer. Before relying on prior project decisions, use `mempalace_search` with wing `operator-dnd-development`; narrow by room or exact source file when useful. Current source files and verified execution evidence take precedence over old memories.
- After a meaningful completed change or durable decision, store a concise factual checkpoint in that wing with date, source paths, actual verification and remaining limitations. Never save hidden reasoning, credentials, unrelated personal data, or raw private campaign transcripts. Original research files must retain their provenance and proposal/not-run labels.
- Use the existing MemPalace MCP connection for developer recall. Its project wings organize knowledge; they are not gameplay authorization boundaries. Do not query the developer palace from gameplay or promote a retrieved proposal into an implemented feature.
- Live gameplay uses the separate private MemPalace index behind Obus, after current campaign/role/owner filtering. The game database, consent rules, source revisions and player decisions remain authoritative. See [memory integration and operations](docs/memory/MEMPALACE.md).
- Codex Coordinator remains the task editing board and native Codex remains task transport. Chronos remains supervision. Do not replace their records with MemPalace delegation events or create duplicate schedulers.

## Codex task-boundary board

- This repository uses the opt-in Codex task-boundary board in `.codex/coordination/project.yaml`.
- Before substantial writes, load the installed `codex-coordinator` skill, list active claims from the primary worktree, and publish only this task's bounded claim.
- Native Codex tasks remain the execution, messaging, and transcript authority; an explicitly requested goal Coordinator is on demand, with no heartbeat or mandatory pull-request workflow.
- Reject cross-project notices and never store transcripts, reasoning, prompts, or tool output in Coordinator state.
