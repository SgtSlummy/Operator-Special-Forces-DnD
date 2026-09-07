# Reviewed campaign content

The host can install one immutable executable campaign pack into an existing campaign with a linked initial mission. This connects authored mission branches to the council and prepared player departures. It does not replace approved characters or activate a map while importing.

Run from raphael-council:

```powershell
npm run game:content -- --action install --campaign CAMPAIGN --host HOST_OWNER --file reviewed-pack.json
npm run game:content -- --action council --campaign CAMPAIGN --host HOST_OWNER
npm run game:content -- --action departure --campaign CAMPAIGN --host HOST_OWNER --request UNIQUE_REQUEST_ID
```

Install input is `{ "reviewed": true, "pack": { ... } }`, at most 1 MiB through the CLI. The pack has schemaVersion 1, id, title, world `{id,title}`, regions `[{id,title}]`, locations `[{id,title,regionId}]`, scenes and missions. No public endpoint exposes the pack.

Each scene contains a map in the existing seed format, locationId, null-owner NPC profiles, effects and ordered entrance coordinates. Player actors, sorted by stable actor ID, occupy those entrances. The current roster and footprints are validated against every scene. NPC IDs must be globally unique across authored scenes. Effects use the existing hazard fields with durationTurns instead of expiresAtTurn; duration starts at destination entry. Saved revisits retain their existing expiry.

Each mission node has mission (the reviewed mission consequence schema), public summary, descriptive cost, trackIds, priorities for all five council members, and next (mission IDs). A node is terminal or offers two to five branches. References, reachability and cycles are checked. Missions may share a map for revisits, but mission IDs cannot repeat in a path. The installed starting node must match the current mission and map. Tracks refer to existing campaign tracks.

After debrief, the council command derives its branches from this pack and cites the current public world revision. After the party chooses, the departure command prepares that selected mission's scene. Players confirm from the browser or Discord. Host review and current membership remain required. Future NPC profiles and consequences stay server-side.

Identical installation returns the same content hash while the starting campaign state is still applicable. Replacing an installed pack is rejected; content migration is not implemented. Packs are copied into the game database and included in its backup. The current loader supports the explicit combat engine's mechanics only. Descriptive cost text does not spend inventory or travel time.

The existing campaigns/behind-the-veil.json is explicitly an authored blueprint, with expedition clocks and operation rules outside this loader's current schema. It is rejected as executable content. Converting that campaign requires implementing those rules and authoring reviewed geometry/profiles; no automatic conversion or completed Behind the Veil runtime is claimed.

Verification checkpoint: an authored three-scene fixture installs without moving actors, rejects broken references and unauthorized replacement, creates council branches, accepts the player's choice and enters the selected map through the prepared-departure service. Full authored adventure content and live hosted acceptance remain outstanding.
