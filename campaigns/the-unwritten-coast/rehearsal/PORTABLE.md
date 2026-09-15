# Portable Undertow pack and player projection

The Undertow Works can now be exported as a versioned GM JSON pack or an explicitly disclosed player JSON view. These are engine-independent data artifacts. They do not install a Unity scene, start multiplayer, authenticate players, or provide a player UI.

## Delivered examples

- `exports/gm/undertow.gm.json`: the complete GM pack, 30,359 bytes; keep private.
- `exports/player/opening.player.json`: 514 bytes, containing only the name and arrival text of R01 Brass Vestibule, with R01 as the current location and no passages.
- `examples/opening-disclosure.json`: the exact GM disclosure used to create that opening example.

Both exports were generated and read back successfully on 2026-09-12. They refer to atlas revision `cc3c2b4401479f40ccdfd7be0daaed77b2207950bb95643f025960f50ca23e1b`. Revision is a SHA-256 change identifier, not a signature or proof of trusted authorship. Regenerate and review disclosures after changing the atlas; an old revision is rejected.

## Export commands

Run from `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons`. Node is required. Choose a new destination filename for every export: existing files are deliberately never overwritten. Keep destinations outside OneDrive.

```powershell
node campaigns/the-unwritten-coast/rehearsal/export.mjs --audience gm --out 'C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\campaigns\the-unwritten-coast\rehearsal\exports\gm\undertow-next.gm.json'

node campaigns/the-unwritten-coast/rehearsal/export.mjs --audience player --out 'C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\campaigns\the-unwritten-coast\rehearsal\exports\player\opening-next.player.json' --disclosure 'C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\campaigns\the-unwritten-coast\rehearsal\examples\opening-disclosure.json'
```

Audience is mandatory. GM outputs must end in `.gm.json`; player outputs must end in `.player.json`. Player export requires an absolute disclosure file path. GM export rejects a disclosure option. The exporter performs no network requests and does not modify the atlas, rehearsal save or live game data. It refuses paths containing a OneDrive directory; this is a path check, not a filesystem alias/junction security boundary.

## GM data contract

`portable.mjs` exports `createPortablePack(atlasText)` and `validatePortablePack(value)`. The validator returns a detached copy or throws. Version 1 is specific to this authored Undertow atlas and requires exactly R01 through R18. It is not a generic arbitrary-dungeon format yet.

Top-level fields are `schemaVersion`, `kind`, `audience`, `packId`, `sourceRevision`, `title`, `units`, `entryRoomId`, `rooms`, `routes`, and `boundaries`. The kind is `undertow-gm-pack`, audience is `gm`, units are feet, and entry is R01.

Each room contains `id`, `name`, `arrival`, `purpose`, `scale`, and `gmNotes`. Scale contains numeric `widthFeet`, `depthFeet`, `verticalFeet`, a `verticalKind` of height/depth/elevation, authored `footprintLabel`, `verticalLabel`, `shape`, and interpretation `footprint-envelope-not-collision-geometry`. Dimensions remain deliberately varied, from a 4-by-6-foot service throat to a 1,600-by-900-foot cavern. A diameter is represented by a square bounding envelope; the hexagonal tower depth is derived from its across-flats width. These values are layout envelopes, not meshes, navigable surfaces or collision shapes. An importer must preserve the authored shape and vertical meaning. Validation checks bounds and types; it does not prove that edited descriptive labels agree with edited numbers.

There are 25 ordinary bidirectional routes. Each contains canonical `id`, `from`, `to`, `bidirectional`, `passage`, and private `gmDetail`. Route IDs sort their endpoints and join them with `--`, for example `R01--R04` and `R01--surface`. Surface is an external location, not an authored room. Validation rejects unknown or duplicate endpoints and disconnected rooms.

Stillwater is held in `boundaries`, with `requiresGmRuling: true`. It is not an ordinary travel edge or a player-selectable exit.

## Disclosure and trust boundary

`projectPlayer(gmPack, disclosure)` runs on the trusted GM or server side. It produces only version/id/revision metadata, the explicitly disclosed current location, selected room fields and explicitly disclosed routes. It never copies room purpose, GM notes, route GM detail or boundary rules.

A disclosure has exactly these fields:

```json
{
  "schemaVersion": 1,
  "packId": "unwritten-coast-undertow",
  "sourceRevision": "cc3c2b4401479f40ccdfd7be0daaed77b2207950bb95643f025960f50ca23e1b",
  "currentRoomId": "R01",
  "rooms": [{ "roomId": "R01", "name": true, "arrival": true }],
  "routes": []
}
```

Room grants always reveal the room ID. `name`, `arrival`, and `scale` are independent optional booleans; only literal `true` reveals a field. Surface supports its name but not scale. Current location must be null or explicitly disclosed. Rooms are not automatically revealed by proximity, visits, or investigation.

Route grants use `{ "routeId": "R01--R04", "passage": true }`. Both endpoints must already be disclosed. A route grant reveals the connection; passage text is an independent option. Revealing two rooms alone never reveals their connecting route. Duplicate grants, unknown fields, invalid types, unknown IDs and mismatched revisions fail closed.

The host must create and authorize grants separately for each recipient. Never accept a player's submitted grant list as authority. Never send the GM pack alongside a player projection, expose it in client assets, or treat the GM rehearsal HTML/save as a player-safe source. Projection does not authenticate a recipient, revoke a previously shared file, or conceal already disclosed knowledge. Authored arrival and passage text is emitted verbatim when granted, so the GM must review that text for the intended audience; structural filtering cannot detect narrative spoilers embedded in permitted fields.

## Verification

```powershell
node --test campaigns/the-unwritten-coast/rehearsal/rehearsal.test.mjs campaigns/the-unwritten-coast/rehearsal/portable.test.mjs
```

All 23 tests passed: 13 existing rehearsal tests and 10 new portable/export tests. New coverage includes JSON round trips, atlas scale and connectivity, malformed and disconnected pack rejection, empty and selective projections, no implicit route disclosure, private-field canaries even under full grants, invalid-grant rejection, recipient/copy isolation, export argument checks, actual disk export/readback, invalid disclosure JSON, and preservation of an existing export on a second write attempt.

Unity compatibility and a server-owned authorization layer remain future work. This pass changes only the rehearsal/export folder and does not edit shared game modules or live saves.
