# Obus boundary handoff

Evidence recorded 2026-09-06. This document specifies the remaining integration fixes; it does not implement them or authorize live activation. Obus remains the sole AI routing authority for Raphael and Davy Jones. Deterministic game services retain rules, membership, consent and state authority.

## Current result and evidence limits

The frozen Operator consumers and the current canonical Obus backend do not yet share a compatible runtime and speech contract. Authenticated capabilities returning HTTP 200 proves reachability and capability metadata, not successful host registration, policy changes, generation or speech.

The root task executed canonical pure-method and route-introspection checks and read `game_runtime.py` and `game_agent.py`. Those checks exposed the mismatches below. This handoff independently read the Operator host-control, transport and lifecycle source through Gortex. Canonical observations are attributed to the root task; no new backend, provider or audio request was made while writing this document.

| Evidence | Latest reported result | What it does not prove |
|---|---|---|
| Operator broad Node run | 1,048/1,048 passed after backup fixes; supersedes 1,006/1,008 | Compatibility with the real canonical backend |
| Operator host checks | Earlier 111 passing; separate diagnostics 7 passing; TypeScript and scoped lint passing | Activated game-host generation or full release supervision |
| Canonical Python checks | 27 legacy checks passing | The frozen JavaScript-to-Python HTTP boundary; those checks do not cover the mismatches below |
| Canonical pure runtime serialization | Six public keys: `bootEpoch`, `contract`, `generation`, `leaseExpiresAtMs`, `policy`, `sessionPolicyRevision` | The required Operator `effectivePolicy` and route-authority contract |
| Canonical route introspection | Policy PATCH exists only at `/api/game/runtime/policy` | The Operator PATCH path is registered |
| Private listener | Root reported PID 27396, execution session 97680, authenticated capabilities HTTP 200 | Stable process identity for a later action, contract compatibility or inference |
| Read-only host diagnostics | Obus reachable/contract valid; `freeRoutes:false`, `codexAvailable:false`, `localSttReady:false`, `metadata:unavailable`, `sessions:[]`, `inference:not-run` | Local inference, real STT, an active session or provider readiness |
| Scoped generation preflight | Default private host-control signer absent; zero generation requests sent; no key created | Registration, renewal or live inference |

Process identifiers are historical evidence, not permission to act on a later process with the same number. Current runtime work remains strict-local, export-disabled and Codex-off. Local plus free providers is the intended later default, not current readiness.

## Frozen consumers

Keep this version set and its bytes unchanged while fixing the backend boundary:

| Artifact | Bytes | SHA256 |
|---|---:|---|
| [@operator/chronicle 0.1.1](../packages/chronicle/artifacts/operator-chronicle-0.1.1.tgz) | 23,907 | `78c8b0748b2ed19bf21741db7b36b805c205f5dd1a056bf3cd3adf1391552575` |
| [@operator/obus-chronicle-provider 0.1.0](../packages/obus-provider/artifacts/operator-obus-chronicle-provider-0.1.0.tgz) | 8,757 | `4f038207f8550a3ca3413bf703af871b4dbfe6378360103ce79fe6c1fc1621f6` |
| [@operator/membership-client 0.1.1](../packages/membership-client/artifacts/operator-membership-client-0.1.1.tgz) | 3,268 | `61e56518d989747f8d0cfde2c3c4d831e27fc1953e666a1a27e3073439233ed0` |

The older Chronicle 0.1.0 remains immutable at SHA256 `5b7f032a1ddedbc9f30ac65a256f319a985059860250b96de192b20327c375c6`. Do not silently replace a package or weaken its validators to accommodate a backend mismatch. A necessary consumer contract change requires a distinct version, fresh installed verification and a coordinated Davy handoff.

The exact current tarballs previously passed isolated installation checks outside the checkout: Chronicle 3/3 package checks plus 11 runtime fixtures; Obus provider 3/3 package checks plus 10 actual-transport fixtures, including both installed packages through real `service.speech` with controlled HTTP responses. Those tests establish the frozen consumer behavior, not canonical backend compatibility. Davy receives only its required service and membership credentials; it receives no host-control signing key.

## Contract matrix and required corrections

Operator references: [host-control client](../ai/host-control.mjs), [Obus transport](../ai/obus.mjs), [host lifecycle](../ai/host-lifecycle.mjs), and [scoped speech handoff](../CHRONICLE_INTEGRATION.md#scoped-speech-contract).

| Boundary | Frozen Operator expectation | Current canonical observation from root | Required backend correction |
|---|---|---|---|
| Runtime GET | Raw `raph-obus-game-runtime-v1` snapshot with `requiredForRoute:true`, `effectivePolicy`, boot/generation/revision/lease and valid queue counts for host-control reads | `RuntimeSnapshot.public()` exposes only six keys and calls policy `policy`; no `requiredForRoute` or `effectivePolicy` | Serialize the compatible public snapshot from authoritative runtime state. Supply real policy and counts, not client-side defaults that bypass authority |
| Host-control HMAC headers | `X-Obus-Game-Host-Timestamp`, `X-Obus-Game-Host-Nonce`, `X-Obus-Game-Host-Signature`; service token remains separate | Backend reads `X-Obus-Game-Timestamp`, `X-Obus-Game-Nonce`, `X-Obus-Game-Signature` | Accept and validate the frozen Host-prefixed protocol with the same canonical signed bytes, timestamp and nonce replay protection |
| Policy mutation path and CAS field | `PATCH /api/game/runtime`; body contains `expectedGeneration` with expected boot/revision, `opId` and policy | Only `/api/game/runtime/policy` is registered; backend uses `generation` | Implement the frozen path and `expectedGeneration` CAS semantics. Any retained legacy adapter must invoke the same authority check and cannot weaken it |
| Register/renew/configure responses | HTTP 200 JSON containing a raw validated runtime snapshot | Backend wraps successful runtime in `status`/`runtime` | Return raw compatible snapshots for those three operations. Preserve the separate child-revoke wrapper below |
| Shared-master renewal | Renewing `session:'campaign'` must extend the live shared-master authority on which child sessions depend, preserving generation and policy revision | Root's full source read found master renewal updates only session lease state | Correct actual master lease renewal and test validity across the old deadline, master expiry, child expiry and replacement; renewing a child must not recreate or extend absent master authority |
| STT storage and repeat request | First valid result can return transcript text; durable replay is `completed_receipt_only`, with no retained backend transcript and no second inference | Current `game_agent.py` persists the full transcript and replays it as completed output | Persist bounded identity/provenance receipts without transcript text/audio; return receipt-only on completed replay and reject changed audio/context under the same request identity |

The child-revoke response is intentionally different: exactly `{status:'session_revoked',runtime:<snapshot>}`. The client verifies a null generation and lease, unchanged expected boot epoch and revision incremented by one. Do not flatten that response while correcting the other three operations.

### Exact runtime and control shapes

A successful runtime GET must expose this shape. UUIDs and times below are symbolic; they are not a live authority token.

```js
{
  contract: 'raph-obus-game-runtime-v1',
  requiredForRoute: true,
  bootEpoch,
  generation, // UUID v4 when active; null when absent
  sessionPolicyRevision, // nonnegative safe integer
  leaseExpiresAtMs, // nonnegative safe integer when active; null when absent
  effectivePolicy: {
    enabled, mode: 'local', exportable: false, codex: false,
    tools: false, personalMemory: false, autoMemory: false,
  },
  queuedCount, // nonnegative safe integer
  dispatchedCount, // nonnegative safe integer
}
```

Raw mutation snapshots must include `effectivePolicy` and the runtime identity/lease fields. Returning the same complete snapshot shape for GET and raw mutation responses avoids divergent serializers. The values must reflect the current shared-master and child authority, including disabled or expired state. Merely renaming an internal `policy` field is insufficient if it omits effective restrictions.

Every mutation body includes `contract:'raph-obus-game-runtime-v1'`. The frozen operations are:

| Method and path | Additional exact request fields |
|---|---|
| `PUT /api/game/runtime/host-generation` | `campaign`, `session`, `generation`, `expectedBootEpoch`, `expectedGeneration`, `opId`, `leaseSeconds:30` |
| `POST /api/game/runtime/host-generation/renew` | `campaign`, `session`, `generation`, `expectedBootEpoch`, `expectedSessionPolicyRevision`, `opId`, `leaseSeconds:30` |
| `PATCH /api/game/runtime` | `campaign`, `session`, `expectedBootEpoch`, `expectedGeneration`, `expectedSessionPolicyRevision`, `opId`, `policy:{enabled,mode,exportable,codex:false}` |
| `POST /api/game/runtime/session/revoke` | `campaign`, `session`, `generation`, `expectedBootEpoch`, `expectedSessionPolicyRevision`, `opId`; session cannot be `campaign` |

The client sorts object keys recursively for canonical JSON, hashes the exact UTF-8 body with SHA256, then signs `method + '\n' + path + '\n' + timestamp + '\n' + nonce + '\n' + bodyHash` with HMAC-SHA256 using the separate hex-decoded host key. Timestamp is epoch seconds and nonce is 64 lowercase hex characters. The service credential is sent in `X-Obus-Game-Token`. Exact method/path signing matters when adding the PATCH route. Verify common request bytes across languages; do not silently regenerate CAS fields or retry an uncertain mutation with a new operation ID.

### Scoped STT result and replay

The frozen speech upload body is:

```js
{
  contract: 'raph-obus-game-stt-v1',
  scope: { campaign, owner: capturedSpeaker, role: 'player' },
  session: capturedSession,
  requestId: stableSegmentId,
  runtime: {
    contract: 'raph-obus-game-runtime-v1',
    bootEpoch, generation, sessionPolicyRevision,
  },
  audio_base64,
  mime_type: 'audio/wav',
}
```

The captured input also contains `leaseExpiresAtMs` and `capturedConsentEpoch` on the game side; these are deliberately not sent as runtime wire fields. Captured scope, session, request ID and fence cannot be rebound to a newer generation after a failure. The provider checks the captured lease before upload and fresh enabled authority before and after inference. Game and voice adapters separately recheck current participant membership, Discord audience and recording consent. Host-only command authorization does not authorize a player's recording.

A first successful response is `{status:'completed',result:{kind:'transcript',text,engine,model,trace:[{destination:'local'}]},receipt:{requestId,...}}`. A completed replay is `{status:'completed_receipt_only',receipt:{kind:'stt',requestId,audioSha256,...}}`. The provider throws a sanitized error with code `RECEIPT_ONLY` for the second case. It never invents a transcript or runs inference again under a fresh ID; the chronicle records a gap/deferred outcome. The campaign chronicle can retain its authorized transcript independently; the Obus speech receipt store must not become a second transcript archive.

Prepare an explicit migration for existing backend transcript-bearing receipts. Validate it on disposable copies, back up authoritative stores before mutation, and verify that current databases, logs and exports do not keep transcript/audio payloads in the receipt path. Do not run a deletion or schema migration as part of this documentation handoff.

## Execution order and ownership

1. Establish the correct canonical backend tool binding. The root's latest native project/Continue-current-task evidence still bound work to the OneDrive Operator checkout despite a Documents-looking label and the user's report that the canonical folder was open. Confirm the actual working directory, Gortex indexed repository and intended canonical file path before editing; a display label is not sufficient. This document belongs to Operator and does not repair that binding.
2. In the correctly bound canonical workspace, inspect current changes and preserve other owners' work. Apply guarded fixes to `game_runtime.py` runtime serialization/master renewal and `game_agent.py` host-control HTTP/HMAC/STT persistence boundaries. Keep routing, policy and dispatch authority in Obus; add no parallel router in Operator, Davy or the membership bridge.
3. Add compatibility fixtures that use the actual frozen JavaScript host-control client and installed Obus provider against the Python HTTP handlers with disposable storage, injected clocks and controlled inference. Start by reproducing each mismatch, then make those cases pass without live provider/audio/campaign data.
4. Verify generation lifecycle and receipt migration on temporary stores, including restart and expiry. Before any authoritative store mutation, take and validate the required coherent backup. Resolve signer configuration only in the correct local game-host scope; reuse an existing dedicated signer if valid or establish one through the authorized setup workflow. Keep its content out of output, Davy, browser assets and package artifacts.
5. Once binding, compatibility, backup and signer prerequisites are satisfied, perform a bounded synthetic strict-local request through the real game adapter and a fresh host generation. Record actual provenance and cleanup behavior. This step has not been executed; prior synthetic inference predates this contract boundary.
6. Complete real Davy capture and mixed browser/Activity validation only after those gates and the separate activation hold are satisfied. Keep free-provider and Codex-on routes unavailable until their enforcement and consent gates pass.

No real provider execution, real audio upload, campaign mutation, live migration or bot activation is part of this handoff. The current preflight sent zero generation requests and created no signer. Correct tool binding and backup prerequisites must precede dependent live work.

## Validation matrix

| Gate | Required evidence before advancing | Current status |
|---|---|---|
| Canonical workspace | Actual task working directory and Gortex repository match the intended backend files; current changes accounted for | Blocked in root's latest binding evidence |
| Runtime GET | Actual Python response accepted by both `getRuntime` and `ObusTransport.runtimeState`; absent/expired/disabled states remain fail closed | Mismatch reproduced by pure serialization |
| Signed control HTTP | Actual JS-generated register, renew, configure and revoke requests pass Python verification; altered body/path, stale timestamp, reused nonce and wrong signer fail | Header/path/body/response mismatches identified |
| CAS and uncertainty | Stale boot/generation/revision rejected; duplicate operation payload stable; changed payload conflicts; no implicit uncertain retry | Existing unit evidence only; boundary cases required |
| Master and child lease | Master renewal survives its old expiry; child renewal cannot resurrect master; master replacement/expiry fences child jobs; child revoke preserves other sessions | Master renewal defect identified; compatibility cases required |
| Scoped STT | Installed consumer succeeds with captured five-field context/four-field wire fence; stale authority before upload/after inference rejected; consent withdrawal and membership removal discard late output | Consumer controlled fixtures pass; canonical integration pending |
| Receipt retention/replay | First response contains text; persisted receipt contains neither transcript nor audio; completed replay returns receipt-only with zero extra STT dispatch; changed audio/context conflicts; restart retains deduplication | Current canonical persistence/replay is incompatible |
| Frozen artifacts | Installed exact three-artifact set, hashes unchanged, no sibling imports or host signer in Davy bundle | Prior installed fixtures passed; no artifact rewrite in this task |
| Live local generation | Current authenticated host generation, traceable local route, no external destination and controlled shutdown/expiry | Not run; signer preflight stopped before requests |
| Local speech | Current route ready, real opted-in Davy audio, speaker attribution, recording gaps, withdrawal/restart/correction and host benchmark | Not ready; real audio unverified |
| Full release | Coherent backup/restore, GM plus two players completing a mission in mixed interfaces with restart; local-only, allowed-free, eligible-Codex and all-AI-unavailable modes | Open |

Passing the 27 legacy Python checks or 1,048 Operator Node checks must not be substituted for the cross-language HTTP and persistence tests above. Manual gameplay must remain usable throughout unavailable AI states.

## Remaining full scope

This boundary repair is part of the full requested game, not a reduction of its scope. Interchangeable Activity/web workflows, campaign-scoped RAG synchronization and embedding benchmarks, optional eligible Codex escalation, verified zero-charge provider routing, complete tactical/world mechanics, persistent Raphael council/counsel, Windows supervision, coordinated recovery and the authored mixed-interface mission remain tracked in [OBUS_INTEGRATION.md](../OBUS_INTEGRATION.md) and [CHRONICLE_INTEGRATION.md](../CHRONICLE_INTEGRATION.md). This handoff changes no backend, provider setting, package bytes or live authority.
