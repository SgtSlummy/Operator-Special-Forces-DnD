---
name: scene-image-generation
description: "Generate revision-safe scene, character, and item imagery for Operator DND through approved local providers, preserving observable facts, tactical ownership, and deterministic fallbacks."
version: 1.0.0
---

# Scene Image Generation Specialist

This skill owns image-provider selection and image-job handoff for the DND
runtime. It does not own game rules, map movement, hidden information, or
Discord message projection.

## Activation contract

Activate when a committed game revision needs a scene, character, item, or
location image, when a local image provider must be checked, or when an image
job has failed and needs diagnosis. Do not activate for tactical movement,
combat adjudication, narrative decisions, or UI-only layout work. Escalate to
the tactical-map specialist when the request changes cover, elevation, stairs,
visibility, or legal movement.

Prerequisites are an authenticated campaign scope, a committed revision, an
observable scene projection, and either an approved library asset or a local
provider configured through the runtime environment. A missing provider never
blocks play; it produces a labeled fallback.

## Situation classification

Classify every request before acting:

| Situation | Required behavior |
| --- | --- |
| Approved asset exists | Use it without generation; preserve its state revision. |
| Local Nano Banana is healthy and no raw references are required | Use the local FastAPI adapter and its documented payload. |
| ComfyUI is configured and approved references are required | Use the local ComfyUI adapter. |
| Obus is configured | Use the local Obus route with no cloud/provider credential handling here. |
| Provider is unavailable, stale, or contradictory | Do not retry blindly; return approved fallback art and record the reason. |

## Decision rules

1. The current deck owns the image for the current state. A result image
   belongs to the next deck and may not be displayed against an older revision.
2. Send only observable text from the current projection. Never derive hidden
   clues, identities, equipment properties, or outcomes from names.
3. Use `subject_type` values `scene`, `character`, `item`, or `location`.
4. Use a documented aspect ratio. Scene views normally use `16:9`; portraits
   normally use `2:3` or a local pixel-art provider.
5. The Nano Banana API accepts prompt metadata but not raw reference uploads.
   If references are present, route to ComfyUI or Obus; never silently drop
   the references.
6. A large image is allowed only after the detail adjudicator confirms a
   specific focus. Ordinary decks use a medium image.

## Execution protocol

### 1. Capture

Record campaign, owner/audience, game revision, scene revision, subject IDs,
observable description, provider mode, and cache key. Exit only when the
snapshot is immutable. Stop if the revision is missing or cannot be matched.

### 2. Select

Check approved art first, then route by the classification table. For Nano
Banana, check the local `/health` endpoint before a first generation attempt.
Provider credentials remain in the provider service and never enter a game
prompt or Discord payload.

### 3. Generate

Send the smallest sufficient prompt and the documented API fields. Keep the
request asynchronous and bounded. Normalize supported returned image data to
PNG for the existing image service. Cache only with a revision-safe key.

### 4. Validate

Validate content type, decoded image bytes, dimensions, and local URL origin.
Attach an audit record containing provider mode, revision, cache key, and
result hash. Do not attach raw prompts or local paths to player-visible cards.

### 5. Publish

Publish the completed image only if its captured revision still matches the
current projection. Otherwise mark it stale and keep the current deck image.
If generation fails, publish approved fallback art with a plain-language
fallback label and continue the game loop.

## Failure taxonomy

- `INVALID_NANO_BANANA_CONFIG`: the configured endpoint is not local or the
  adapter is malformed.
- `NANO_BANANA_REFERENCE_UNSUPPORTED`: the Nano Banana contract cannot accept
  a supplied raw reference; route to a provider that can.
- `NANO_BANANA_REMOTE_URL`: the service returned a non-local image URL.
- health failure: the local service is offline or malformed; use fallback.
- stale revision: the image completed for an older state; never display it as
  current.
- unreadable or oversized bytes: reject the result and keep fallback art.
- prompt-boundary failure: the description contains unsupported or hidden
  information; redact and regenerate only from the visible projection.

## Invariants

- Image generation never changes action, resource, movement, visibility, or
  game time.
- GameStore remains the sole authority for state and revision.
- No provider receives private chain-of-thought, hidden facts, or credentials.
- No image is displayed for a different game revision.
- A provider failure never makes the campaign unplayable.
- Player-facing output contains a readable status, not raw JSON or diagnostics.

## Invalid shortcuts

Do not call a remote image URL directly from the browser, accept a public
provider URL, treat a generated image as tactical truth, drop references
without recording the route decision, or retry an expired job as a new paid
generation. Do not put prompts, file paths, provider traces, or private agent
reasoning in Discord player threads.

## Handoff packet

Return: campaign and owner scope, captured revision, scene/subject IDs,
provider selected, health result, cache key, output status, PNG validation
result, stale/fallback reason, output hash, and the exact next specialist if
the request is blocked. Behavioral proof is fresh only when the provider tests
and revision-safety tests have been run after the last contract change.

## Evaluation

Use the semantic families in `evals/scenarios.json` and the API mapping in
`references/ai-dnd-api-contract.md`. The provider unit tests are deterministic;
live FastAPI/Gemini availability is an integration check and must not be
claimed from unit-test results.
