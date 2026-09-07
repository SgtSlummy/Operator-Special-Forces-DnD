# Scene image verification

Verified locally on September 6, 2026.

| Check | Result |
| --- | --- |
| `node --test images/*.test.mjs discord/*.test.mjs characters/*.test.mjs` | 119 passed, 0 failed. |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed on the current workspace. |
| Scoped ESLint for `images`, `app/scene-images.tsx`, `app/api/scene-images`, `discord`, and `vite.config.ts` | Passed. |
| `npm run build:game` | Local Node production build passed. |
| `npm run test:images:e2e` | 1 production HTTP integration test passed. |
| Browser inspection | The campaign page displays **Show what I see**; its private connection panel renders with a labeled access-code field and readable layout. |

The HTTP integration check starts the built app on an isolated local port with a temporary database and an explicitly empty provider key. It verifies authentication, the current scene, request creation, durable polling, private image delivery, repeat-request reuse, and rejection of another player's request for the image. The returned PNG hash matches the explicitly approved opening-lantern library image. Temporary access codes are not logged.

Unit and adapter coverage includes private and party views, stale snapshots, focus validation, reference validation, revocation, cross-process queue claims, expired-worker fencing, restart persistence, malformed image bytes, provider request structure, HTTP Origin checks, private Discord replies, automatic completion delivery, and refresh recovery. Provider and Discord network calls are mocked in those checks.

The broader lint invocation including the pre-existing planning page reports `react-hooks/set-state-in-effect` in its local-storage hydration effect. That effect was outside this image feature; it was not suppressed or rewritten. An intermediate type check encountered concurrent tactical-page edits; the subsequent current-workspace type check passed.

## Activation limits

- No live OpenAI image request or live Discord interaction was performed. Local configuration reports that the image API key and Discord settings are absent.
- No remote host was deployed and no Discord desk message was published. The local preview used only loopback networking.
- The production build above verifies the local Node host, not Cloudflare/Sites hosting.
- The host must publish the current player-visible scene and update it as play changes. Tests use explicit scene fixtures; they do not demonstrate automatic adventure narration or visibility publication.
- Browser visual inspection covered the connection panel. The signed-in request and PNG retrieval flow was verified through production HTTP, not a live multiplayer browser session.

Follow [README.md](README.md) to configure the host and publish the actual current view before players use the feature.

## Distance and reach delivery

The distance/reach extension was verified on September 6, 2026:

- 15 numerical and privacy tests in `game/reach.test.mjs` passed. Eleven HTTP checks exercise both authenticated browser boundaries, including pauses, other turns, no image calls, no rolls/writes, hidden-target rejection and revocation.
- Seven new Discord reach tests passed; the complete Discord suite at that checkpoint passed 82 tests.
- The combined game/map/image/Discord/character regression run passed with zero failures.
- TypeScript, scoped lint and the local Node production build passed.
- The production HTTP integration test returned identical distance answers through the game and image session routes, alongside the existing private PNG delivery check.
- A real browser check used a disposable local campaign: Arden saw the guard 20 feet away, needed 15 feet of movement to stand beside it, had 30 feet remaining, and was outside the spear's configured 5-foot range. The visible page retained the same turn, movement and empty roll history. The layout was visually inspected.

No live Discord session or paid image request was used for this verification. Measurements require the host's actual mapped positions and character profiles. Unsupported abilities remain explicitly unconfigured.
