# @operator/obus-chronicle-provider 0.1.1

Portable server-side consumer for Davy Jones. Obus is the sole AI routing, policy and execution authority. This package exports `ObusTransport` and `createObusChronicleProvider`; it does not construct GameAi, start a bot, choose models or load the Operator platform. Node >=22.16.0 is required. The installed package has no runtime package dependencies.

## Composition

Use this provider with `@operator/chronicle@0.1.2` and `@operator/membership-client@0.1.1`. Install the three reviewed local tarballs into Davy, then inject the existing gateway-owned adapters. They are intentionally separate packages; no sibling checkout is needed.

```js
import { ObusTransport, createObusChronicleProvider } from '@operator/obus-chronicle-provider';
import { createMembershipClient } from '@operator/membership-client';

const membership = createMembershipClient({ url: privateMembershipUrl, token: membershipToken });
const provider = createObusChronicleProvider({
  campaigns: [configuredCampaign],
  transport: new ObusTransport({ url: privateObusUrl, serviceToken: obusServiceToken }),
  authorizeCommand: membership.authorizeCommand,
  authorizeParticipant: membership.authorizeParticipant,
  onReceipt: recordPrivateProvenance,
});
```

`authorizeCommand` remains host-only. `authorizeParticipant` verifies current game membership and never grants capture consent. Missing participant authorization denies speech. Credentials remain private: the Obus service token, membership token and host-control signing key are separate. Davy receives no host-control signing key. The private Obus service uses literal loopback, normally `http://127.0.0.1:38175`; the generic route endpoint is never used.

## Provider methods

`write(kind, evidence, context)` supports `summary`, `final` and `cue`; context contains `campaign`, `session`, `owner` and `sourceRevision`. Supply corrected, authorized chronicle evidence. The provider snapshots and bounds input, rechecks current host membership, supplies a stable request fingerprint and validates text and actual local-only provenance. Full chronicles always narrow policy to local mode, Codex off, external export off, no tools and no personal/automatic memory. This does not bypass shared all-AI-off or a missing/expired/replaced game-host generation.

`writeReferences('summary', references, context)` uses the private store-backed evidence bridge supplied by the host composition. In version 0.1.1 that bridge captures `raph-obus-game-evidence-refs-v2`: a baseline revision, bounded source references and a hash of their complete dependency set and contributor consent. No raw transcript is accepted through this method. Obus resolves the signed stored evidence, checks current access and external consent, renders its fixed `session-summary-v1` template and makes every routing decision. Only that bounded template may request host-approved free fallback; full chronicles and final recaps remain local-only.

The backend must advertise refs-v2 explicitly. The transport validates its returned baseline revision and the provider checks the exact source set, current host authority and selection after generation and receipt storage. Unrelated new chat may advance the stored projection; a correction, deletion, hidden source or relevant consent change rejects the affected result. A backend without refs-v2 support fails closed without silently resending as refs-v1. Legacy explicitly injected bridges without a selection capability retain refs-v1's stricter whole-snapshot behavior.

`captureReferences` is an optional synchronous private guard for Chronicle's final summary transaction. Only a trusted composition may supply its backing store capability. It grants no model access or independent routing authority. Keep the previous 0.1.0 archive for rollback when installing 0.1.1.

`onReceipt(record)` is optional and awaited. It receives bounded routing provenance, source references and revisions, not transcript/generated prose. Failure to persist the receipt fails the operation. Obus owns dispatch deduplication and scheduling; this consumer creates no independent policy authority or dispatch database.

`authorizeParticipant(scope)` returns exactly true only when the injected membership callback permits the allowed campaign and participant.

`captureRuntime(hostScope, sessionId)` checks current GM authority before and after Obus lookup and returns a frozen `{contract:'raph-obus-game-runtime-v1',bootEpoch,generation,sessionPolicyRevision,leaseExpiresAtMs}`. Capture runtime is host-authorized; do not pass a player's scope to that method. The utterance itself belongs to its captured speaker.

`transcribe(wavBuffer, context)` requires this second argument:

```js
{
  scope: { campaign: capturedCampaign, owner: capturedSpeaker, role: 'player' },
  session: capturedSession,
  requestId: stableSegmentId,
  capturedRuntime: {
    contract: 'raph-obus-game-runtime-v1', bootEpoch, generation,
    sessionPolicyRevision, leaseExpiresAtMs,
  },
  capturedConsentEpoch,
}
```

Bind that context when audio is received, before it can be reassigned to another session or host generation. WAV bytes are bounded to 6,000,000 bytes. The provider freezes context and copies audio before authorization awaits. The voice receiver must establish capture consent, captured consent epoch, game/Discord membership and audience authorization before retaining audio, before upload and before saving text. Chronicle0.1.1 independently rechecks these conditions through its scoped `service.speech` API. The service-token-authenticated Obus endpoint does not independently prove Discord membership or consent.

The transport performs fresh runtime GETs to validate the original boot/generation/policy revision and current enabled, unexpired lease before upload and before returning text. Renewal may extend expiry; it never changes a captured identity. The POST path is `/api/voice/transcribe`, with exact body `{contract:'raph-obus-game-stt-v1',scope,session,requestId,runtime:{contract,bootEpoch,generation,sessionPolicyRevision},audio_base64,mime_type:'audio/wav'}`. Capture-only expiry and consent epoch are not wire fields. The old audio-only request is unsupported.

A completed transcript returns a string. A `completed_receipt_only` response throws without rerunning the model; record a gap/deferred result rather than inventing text or submitting a new request ID. Stable retries retain the original audio identity, request ID, scope and runtime fence. Missing/stale authority, disabled policy, revocation, invalid output or outage never selects another provider. Raw audio is cleared after processing and must not be archived or exported.

## Build and review

Run `npm install --ignore-scripts`, `npm run build`, `npm test`, and `npm run pack:artifact` from this source directory. The seven build inputs are the package entry, `ai/obus.mjs`, `ai/host-control.mjs`, `ai/evidence-upload.mjs`, `ai/evidence-selection.mjs`, `chronicle/obus-evidence.mjs` and `chronicle/obus-provider.mjs`. Only Node built-ins may remain external. Shared validation helpers are bundled; no host signing key, default provider, GameStore or gateway startup is included. Isolated installation tests exercise the actual exported transport, refs-v2 capability/baseline/consent checks and co-installed Chronicle 0.1.2 with controlled responses. They never connect a gateway or live Obus.

The tarball contains only `package.json`, this README and `dist/index.mjs`. Versioned artifact manifests and the build audit record source, bundle and package hashes. Packaging refuses to overwrite an existing tarball. Installing this package does not start services, enable recording, establish a host lease or prove live Discord/STT readiness.
