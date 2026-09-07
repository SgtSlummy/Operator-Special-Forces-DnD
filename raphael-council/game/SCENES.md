# Connected encounter scenes

`npm run game:scene -- --file <reviewed-transition.json>` activates the selected council branch. This is a trusted local host command. The existing browser and Discord revision readers display the destination after commit. To let a player initiate travel, add `--prepare`. This validates the full transition in a rolled-back rehearsal and saves a departure without moving actors or advancing the mission. Players can then use Next scene in the browser or Discord Mission & counsel, review the party-wide action, and confirm entry.

The JSON contains `campaign`, `reviewedBy` (a current host owner), `reviewed: true`, a unique `requestId`, `expectedRevision` (game), `expectedWorldRevision`, `destination`, `placements`, and `mission`. The previous encounter and debrief must be complete and the council must have a saved player selection. Mission ID and title must match that selection.

For a new map, `destination` contains `mapId`, `map` in the host seed format, `npcs` with validated profiles and null owners, and `effects` in the existing hazard format. New NPC identifiers cannot reuse an actor from another map. For a revisit, use only `{ "mapId": "previous-map-id" }`; saved terrain, NPC HP and zones are loaded automatically.

`placements` must contain exactly one `{ "actorId": "party-actor-id", "x": 1, "y": 1 }` per player actor. No HP or profile overrides are accepted. Current HP, including zero HP, is carried forward. The destination resets the encounter round/action/movement budget; it does not heal or rest the party. The global turn ordinal advances once. Zone expiry uses that ordinal, and expired zones are removed on revisits. Travel duration and actor-attached effects are not yet supported.

`mission` uses the existing reviewed mission schema: ID, title, briefing, destination mapId, successTeam and success/failure summaries with deltas for existing world tracks. Previous public mission state is archived; track values carry forward. Council cost text remains descriptive and does not spend inventory or time automatically.

The archive, map revision, mission activation and request receipt share one transaction. Identical retries return the saved receipt; changed input with the same request ID fails. Invalid destinations or mission plans roll back all writes. Game database backups include the scene and mission archives. Coordinated character/image recovery remains separate work.


Prepared departures expose only their ID, public mission title/briefing and revision anchors. Map geometry, NPC profiles, placements and outcome plans stay server-side. Player requests accept only departureId and requestId. Host membership is checked again on entry. A newer preparation supersedes older controls; stale world/game revisions reject entry. Successful retries use the original player receipt. Any current campaign member may initiate the whole-party departure, matching the shared council choice policy; this is not an individual token transfer.
