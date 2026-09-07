# Show what I see

Players can request a Witnesslight image from the browser header or Discord's **Show what I see** button. It is available during exploration, conversations, combat, other players' turns, pauses and downtime. An image request costs no game action or resource and does not advance time or resume play.

Both interfaces use the same persistent service. The host publishes the observable scene for the party or a particular player. Players can request that view or focus on one of its visible subjects. An unchanged view reuses its image; a newly published revision can produce a new render. The image retains the scene revision and source event from request time. Old results are labeled when the current view has changed.

## Local host setup

The code and offline tests are implemented. Live use requires a running host, its credentials, and a published current view. The planning page, tactical `/play` page and Discord adapters do not automatically publish Witnesslight scene snapshots. Publish a new projection after narration, movement, visibility changes or resolved player choices. The existing tactical engine can be connected to `publishScene` for automation; its precise **Map image** is a separate rendering of game state. Until that connection is implemented, the host supplies each updated narrative view.

1. In `raphael-council`, copy `.env.example` to `.env.local` if that file does not already exist. Runtime image generation is routed exclusively through the private Obus game agent and is available only when it advertises an enabled local image route. Configure providers in Obus; no provider key belongs in the game. Set the existing Discord settings for the bot. Never put keys in browser code or chat. The game's Image API connection is separate from the built-in image tool used to make the 66-image art library.
2. Use the same `RAPHAEL_IMAGE_DATA_DIR` for the Discord process and browser host. The default is local application data under `Raphael/scene-images`, outside OneDrive. Leave `RAPHAEL_ART_ROOT` empty while the art library remains beside this project; set an absolute path when moving it.
3. Copy `images/opening-scene.example.json` to a host scene record and set its campaign, visible facts and source event. Use the opening example unchanged only for that actual opening. Publish with `npm run images:host -- publish path/to/scene.json`. Publication records an observation snapshot; it never moves a hero or changes the story itself.
4. Run `npm run dev:game` for the local Node browser host, or `npm run build:game` then `npm run start:game`. This mode supports local SQLite and image files. The existing Cloudflare/Sites presentation mode is not the persistent image host. Remote players need an appropriately hosted Node app with persistent storage and HTTPS; no remote deployment is performed by this feature.
5. For Discord, run the existing `npm run bot:publish` once to update the pinned desk when ready, then `npm run bot`. Publishing sends a message to the configured channel; it is not part of local verification. The desk includes **Show what I see**. Existing scene/turn/pause cards also expose it when the adventure adapter renders those cards.
6. Players connect their browser privately using **Show what I see → Browser access** in Discord, or a code issued by the host with `npm run images:host -- access greyharbor DISCORD_PLAYER_ID`. Enter it in the browser's image panel. Use the same player identifier in individual scene records. Codes expire after 30 days; `npm run images:host -- revoke greyharbor DISCORD_PLAYER_ID` revokes that player's browser codes, including existing browser sessions. Revoke codes when a player leaves the campaign.

Check local configuration without connecting to a provider or Discord:

```powershell
npm run images:host -- check
```

New renders use the host's configured OpenAI API usage. A host-approved existing image can be shown without a provider call. An unconfigured generator gives an explicit setup message; it never substitutes an unrelated library image.

Restart both hosts after connecting or changing the API key. After an abrupt host crash, a running request can remain pending until its ten-minute lease expires; Refresh then reports the interruption and a new request can retry. A late result from an expired worker cannot replace that recorded failure.

## Publishing only what the player sees

`publishScene` accepts this host-only record:

| Field | Meaning |
| --- | --- |
| `campaign`, `audience` | Campaign ID and `party` for shared observations, or an exact player ID for a personal view. |
| `id`, `title`, `sourceEventId` | Scene identity, player-visible caption, and the validated event/recap supporting it. These must contain no secret names. |
| `description` | Observable view, position, light, weather, visible people/objects and limits of perception. No DM secrets or undisclosed information. |
| `references` | Up to four explicitly approved image IDs whose visible content is appropriate for this audience. |
| `approvedImage` | Optional existing image ID approved to represent this exact current view. Null means generate a new image. |
| `subjects` | Visible focus options with `id`, `label`, `description`, optional `reference`, optional `approvedImage`. |

Publish individual records when the party separates or a hero perceives something privately. A personal view takes precedence until the host updates it or runs `npm run images:host -- rejoin-party CAMPAIGN PLAYER`. The host must update every affected personal projection when facts change; publishing a party record does not silently move a separated hero back to the party.

Art visibility folders are editorial notes, not automatic permission. The host must review every selected reference and approved image against the current viewer. Never make the entire art directory or manifests a public static route. The service opens only registered image IDs and returns a PNG only after authenticating its owner's job.

The focus request cannot conduct a search, reveal beyond a closed door, read illegible writing, bypass darkness or gain a new clue. Use normal observation or game actions when new knowledge must be earned. Artwork may simplify visible geometry and includes incidental noncanonical detail; rulings and canonical text remain authoritative. Player appearance references must come from the player. Preserve Witnesslight's realism, dramatic light and selective detail.

## Distance and reach questions

In the browser, choose **How far? Can I reach it?** beside the image button. In Discord, choose **Distance & reach** on your private view card. Select your character and a visible target, or enter a visible map coordinate such as C4. The answer is private and available while another character acts, while play is paused, and while an image is still rendering or has failed. Asking never moves a character, attacks, rolls dice or spends resources. Distance questions do not call the image generator.

The answer separates three things:

- **Grid distance in feet:** measured from the nearest occupied cells using this campaign's existing five-foot grid-step policy.
- **Movement required:** the shortest known route through visible terrain, accounting for difficult terrain, occupied spaces, blocked corners and the character's size. For a creature, the route stops beside it; for a coordinate, it places the token's upper-left cell there. It compares that cost with movement remaining this turn, or normal movement on a future turn when another character is acting.
- **Configured weapon range:** whether the target lies within range from the character's current position, with known line of sight, turn, action and character availability explained separately. Being in range does not promise a hit.

Measurements use the current tactical map, not the pixels or perspective of an illustration. The result names its map revision; refresh before acting if play changes. Only player-visible geometry is consulted. An unknown route is reported as unknown, and no hidden hazards or creatures are disclosed. Spells, jumps, flight, climbing, Dash and other unconfigured mechanics require the host's ruling.

The host must first prepare the tactical campaign and the player's approved character through [game setup](../game/README.md). No additional image API setup is needed just to answer distances. `/play` uses its existing game connection; the campaign council uses its image-panel connection. Discord uses the same campaign and player identifiers. If there is no mapped position or character, the controls explain the missing setup rather than guessing a distance from the artwork.

## Runtime behavior and recovery

Jobs and their request-time snapshots persist in SQLite. Each interaction/request ID is idempotent. The unchanged-view cache is scoped to a campaign and player, and the two hosts coordinate rendering through a database lease. Requests do not access character statistics, rolls, turn ownership, readiness or threat clocks. A pause stops story changes while read-only image requests remain available.

Discord acknowledges privately, presents progress and delivers the image privately. Refresh recovers the same job. The browser polls with a visible stopping point and offers Refresh. Authentication is repeated for every status/image HTTP request; browser scope comes from an opaque private access code in an HttpOnly cookie, never from client-supplied player or campaign fields.

Generated PNGs and companion JSON records are saved under `RAPHAEL_IMAGE_DATA_DIR/renders`. They record the exact prompt, approved references, source snapshot, owner, revision and hash. Earlier files are retained. A provider error is sanitized; no secret configuration or full upstream error is shown to a player. An expired interrupted lease fails explicitly and requires a fresh user request, avoiding an automatic repeated charge after an ambiguous provider result. Generation has a four-minute provider timeout; one render runs at a time across the shared database. Additional requests queue without any in-game cost.

The production provider follows the [official Image API generation/edit contract](https://developers.openai.com/api/docs/guides/image-generation) and uses [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2). Reference inputs use the edit endpoint, and results are decoded as PNG before delivery. No live provider request is part of the offline tests.

## Verification

```powershell
npm run test:images
npm run test:characters
npm run build:game
npm run test:images:e2e
```

Tests cover current/private projections, hidden subject rejection, no game mutation, repeat clicks, cross-process claims, stale snapshots, restart persistence, private views, access revocation, missing providers, invalid image bytes, HTTP authentication/Origin checks, and Discord privacy/delivery. The opt-in browser integration test uses a temporary local server and an approved library image without contacting an image provider. See [VERIFICATION.md](VERIFICATION.md) for the checks actually run for this delivery.
