# Full portable-pack fixture

The third and final scheduled build pass exercised the existing adapter against the real Undertow GM pack and opening player export on 2026-09-12 UTC. **17 C# adapter checks and 23 Node rehearsal/export checks passed.** The added fixture is confined to `fixture/PackFixture.cs`, with one call from the existing console entry point. No gameplay API, Unity project, scene registry, or live store was changed.

## Verified behavior

- All 18 unique authored rooms bind to explicit disposable `fixture-undertow-rXX` scene IDs. Every width, depth, vertical dimension and vertical qualifier survives the adapter's feet-to-meters conversion. The 4 ft service slot and 1,600 ft cavern retain their widely different scales.
- All 25 ordinary passages are checked in both directions: 48 destinations reach their explicitly bound fixture scene IDs, and two unbound surface exits are rejected before invoking the loader. A future host must supply its own surface behavior; this fixture does not create it.
- The signal tower at R16 remains reachable from R01 through ordinary passages with the optional narrow R02 slot excluded.
- Stillwater remains a separate GM-controlled boundary. It cannot load through the ordinary adapter. A mismatched pack revision is also rejected before loading.
- The actual opening player export has matching pack/revision identifiers, contains only R01's approved name and arrival description, and contains no routes. Exact field allowlists reject extra GM or undisclosed fields. The Node suite separately exercises explicit per-recipient disclosures, malformed grants, all-room grants, and exclusion of private notes, purposes and boundary rules.
- The existing 11 adapter checks continue to cover request identity, cancellation, cooperative timeout, loader failures, unknown rooms, binding validation, revision mismatches and immutable binding collections.

## Reproduce

Use the canonical local project root as the working directory:

```powershell
Set-Location -LiteralPath 'C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons'
dotnet run --project campaigns/the-unwritten-coast/rehearsal/unity-adapter/fixture -- 'C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\campaigns\the-unwritten-coast\rehearsal\exports\gm\undertow.gm.json' 'C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\campaigns\the-unwritten-coast\rehearsal\exports\player\opening.player.json'
node --test campaigns/the-unwritten-coast/rehearsal/rehearsal.test.mjs campaigns/the-unwritten-coast/rehearsal/portable.test.mjs
```

Both commands exited 0. The C# result was `PASS: 17 adapter checks; real project contracts linked; no Unity Editor or scene was opened.` The Node result was 23 passed, zero failures and zero skips. No compiler warnings were emitted by the fixture run. Running the fixture without its two absolute data paths retains the original 11 checks and explicitly reports that full-pack checks were skipped.

The JSON files are fixture inputs, not installation instructions. The GM pack and rehearsal HTML contain private authored material; share only a reviewed player export. The scene ID prefix used by this fixture does not refer to existing Unity scenes.

## Limits and handoff

This is a disposable contract/data exercise, not a human playtest or proof of Unity scene loading. Its recording loader deliberately returns a failed/no-real-load result; assertions verify that the existing coordinator preserves that result and the exact request mapping. It makes no gameplay, network, credential, multiplayer-security or audio-performance claim.

Do not import the validation `ContractCheck.dll` into Unity: it contains linked copies of game contract types for compilation checks. Runtime adapter installation requires separate compatibility evidence and a host-owned, explicitly authorized scene-binding map. The separate Unity 6 migration remains blocked before its first intermediate Editor upgrade; this fixture does not resolve or change that installation status.

Gortex post-edit detection encountered pending indexing. Scoped tests reported no graph-mapped targets; no guard rules are configured. The scoped contract check allowed the entry point and fixture changes, with a lower-bound medium risk assessment. The executable test results above are the verification evidence; no complete graph-wide clean verdict is claimed.

The three-run scheduled build series is capped and paused. The next milestone requires a separately authorized host integration after the Editor migration is available, followed by actual in-Editor validation and a GM-supervised playtest. Existing campaign authority, live campaigns and Chronos supervision remain unchanged.
