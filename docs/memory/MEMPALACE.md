# MemPalace — project and gameplay memory

Enabled configuration: September 9, 2026. The user explicitly requested MemPalace for **both Codex project memory and live gameplay memory**. This integration uses the existing local MemPalace 3.7.1 installation; it does not automatically upgrade to the upstream `develop` branch or replace existing stores.

Upstream: [MemPalace repository](https://github.com/MemPalace/mempalace). Integration API: [3.7.1 backend contract](https://github.com/MemPalace/mempalace/blob/v3.7.1/mempalace/backends/base.py). License: MIT, as reported by the upstream repository. Benchmark claims are not project acceptance evidence.

## Developer library — available now

The existing `mempalace` MCP connection serves the local developer palace at `C:\Users\Hermes\mempalace-palace\.mempalace\palace`. Operator knowledge uses wing **`operator-dnd-development`**. The original D&D research, acceptance JSON and research index are filed verbatim with their canonical source paths. Their rooms are `dm-procedures`, `acceptance-proposals`, and `research-limitations`. A `memory-contract` room records the user's integration scope.

Project [AGENTS.md](../../AGENTS.md) makes scoped MemPalace recall the project memory workflow. Gortex remains the code navigation and edit authority, native Codex remains task transport, Codex Coordinator remains the editing board, and Chronos remains supervision. This creates no duplicate Governor, scheduler or delegation system.

Search with `mempalace_search`, `wing: "operator-dnd-development"`, a short query, and an optional room/source-file filter. Check current source files and execution evidence before treating a memory as current. Store factual outcomes and durable decisions with provenance; do not store hidden reasoning, credentials or unrelated personal data. The original source documents remain unchanged even when a later task implements something new.

The 48 imported Given/When/Then cases remain **not_run**. Memory integration tests are separate tests of this adapter. Research limitations, uncertain rules-family mapping, and illustrative-fixture labels remain intact.

## Gameplay integration — configured; service activation pending

The canonical Obus backend is `C:\Users\Hermes\Documents\obus-moa-exe`:

- `backend/game_mempalace.py` supplies the private memory worker.
- `backend/game_retrieval.py` uses it for bounded ranking of currently authorized sources, with the existing lexical/local-embedding fallback.
- `backend/game_agent.py` rechecks current database records and access after memory ranking and exposes memory configuration/query status in authenticated capabilities.
- `tests/test_game_mempalace.py` verifies the new boundaries using disposable stores.

The game service reads `C:\Users\Hermes\.occultbus\game-agent\mempalace.json` by default, or the explicit `OBUS_GAME_MEMORY_CONFIG` override. It currently enables MemPalace and names:

| Purpose | Local path |
|---|---|
| Isolated installed Python | `C:\Users\Hermes\mempalace\.venv\Scripts\python.exe` |
| Gameplay memory index | `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\local\memory\gameplay` |
| Cached CPU embedding model | `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\local\memory\models\all-MiniLM-L6-v2` |

The model was copied from the existing local cache and verified by hashes. The worker prohibits automatic downloads and uses CPU-only local ONNX embeddings plus MemPalace's `sqlite_exact` backend. No provider key, remote embedding endpoint or developer palace is used by gameplay. Generated model/index files are ignored by Git.

The application's execution policy rejected starting the private Obus game service during this integration. Therefore configuration and source integration are present, but a running production process has not been verified to use them. No existing service was terminated or replaced. After the normal private game-agent startup is allowed, authenticated `/api/game/capabilities` should show `memory.engine: "mempalace"`, `configured: true`, and `last_query_status: "ready"` after a successful source retrieval. `not_queried` is not a successful-query receipt; `fallback` means the existing retrieval path was used.

## Authority and data boundaries

The game database remains the source of truth for campaign state, accepted source records, access, revisions, tombstones, consent, mechanics and player decisions. MemPalace returns rankings, not authoritative replacements or state-changing commands.

The existing SQL filter applies campaign/role/owner access before candidates reach MemPalace. The adapter uses at most 32 already-selected candidates from the existing bounded scan. Separate hashed campaign directories and exact content/revision/access identities constrain the vector query before ranking. Returned IDs must belong to the current candidate set; results are original current source objects, never arbitrary stored text. A second database/access check drops sources changed during memory work.

The index is populated lazily from approved retrieval candidates. It does not indiscriminately copy a whole campaign, developer research or transcripts. Existing reference-selected chronicle summaries continue through their original signed source/consent path; this adapter does not broaden that selection. Wing names alone are not security boundaries.

A source correction or access change produces a new identity; old cache rows cannot participate in a current query. The worker removes obsolete vector rows for the active references it processes. Tombstoned or otherwise excluded references are logically invalidated; this does not promise forensic erasure of their vectors. The gameplay cache stores derived vectors, empty document fields and opaque identifiers, with no duplicate source text or query text. Full source text stays in the authoritative game database. Keep both stores private and include them in the operator's normal local-data protection practices.

Each worker invocation is bounded to 15 seconds and one concurrent invocation per game process. A failed, busy, missing or misconfigured worker uses existing retrieval behavior. Model inputs remain bounded; embedding prefixes depend on the candidate budget and are included in cache identity. Enabled memory configuration is disclosed in game receipts, including that the cache retains derived vectors and opaque identifiers only. This is bounded reranking, not a claim of exhaustive whole-campaign semantic recall.

## Verification and operation

The final selected run passed **197 tests in 13.08 seconds**, including **15 memory tests** and the real installed MemPalace backend. Coverage includes persistent vectors without source/query text, exact candidate isolation, source revisions/access changes, invalid-result rejection, timeout fallback, omitted lexical matches, and existing game-agent/commit/evidence behavior. This run used disposable stores and an explicit disabled production-memory configuration for the existing regression tests. These are not executions of the 48 imported gameplay specifications.

CodeRabbit's first review identified three issues in cache retention disclosure, omitted lexical matches, and invalid-score test setup. All three were addressed. The follow-up review completed successfully with **zero findings** across `backend/game_agent.py`, `backend/game_mempalace.py`, `backend/game_retrieval.py`, and `tests/test_game_mempalace.py`.

Gortex's final change scan could not finish because its source index still reported a pending refresh (`mutation-670`, generation 953). Graph test discovery returned no targets, no guard rules were configured, and the contract result was explicitly a lower bound. The executed tests and CodeRabbit review above are verified; a complete final graph scan is not claimed.

## Hermes support evidence

The existing synthetic Node evidence-selection gate was run with `node --test ai/evidence-selection.test.mjs`: **24 passed, 0 failed, 1 intentionally skipped** Python cross-runtime test, exit 0. `OBUS_EVIDENCE_TEST_ROOT` was omitted, so no live Obus service, provider, or cross-project integration was invoked. The test and its three imported source-file hashes were stable across the run. Evidence is retained at `C:\Users\Hermes\LocalFiles\dnd-thread-aid\20260909-105032\evidence-selection-test-result.json` and `evidence-selection-test-output.txt`. This is existing selection-layer evidence and is not validation of the MemPalace adapter.

The review of `raphael-council/ai/obus.mjs` identified three useful acceptance checks. Candidate input must contain only currently authorized gameplay records; revocation during a paused rank must be rechecked against the authoritative database before generation or source metadata; and unknown, duplicate, stale-revision, or modified-text ranker references must be rejected, deduplicated, and hydrated from the authoritative database. The current selected suite now covers these boundaries, including a forged-result hydration/deduplication regression; it does not convert the synthetic Node run into live acceptance.

A follow-up malformed-worker-response check found that oversized integer cosine values could reach `math.isfinite` before the range guard. The guard order was corrected in `backend/game_mempalace.py`. The supplied stdlib-only reproducer now passes **4/4**, including large positive and negative integers; it started no worker and made no database/provider call. The selected project regression remains **197 passed** and the latest CodeRabbit review found **0 findings**. This is robustness evidence for a private malformed response, not evidence of an exploit, privacy leak, or live-service failure.

For an adapter test run, use the canonical Obus Python, an explicit disposable memory configuration, and `OPERATOR_TEST_MEMORY_PYTHON` / `OPERATOR_TEST_MEMORY_MODEL` pointing to the local installed runtime and model. Tests must never seed invented examples into the production campaign database.

To disable this integration reversibly, set `enabled` to `false` in the private memory configuration. The next retrieval uses the existing fallback; no source database migration or deletion is required. Preserve the local memory directory until it is intentionally retired under the operator's data-retention policy.
