# Undertow scene adapter — isolated compatibility check

This folder contains C# adapter source and an executable contract fixture. It prepares host-approved Undertow room bindings for the existing scene loader without changing the Unity project. It is not an installed campaign, a scene asset importer, or a playable Unity build.

## Verified environment — 2026-09-12 UTC

The official Unity CLI 1.0.0-beta.9 reported:

| Item | Observed value |
| --- | --- |
| Canonical project | `C:\Users\Hermes\Projects\Operator Special Forces Dungeon and Dragons\RPG-Core\station` |
| Project Editor version | `2021.3.14f1` |
| Project changeset | `eee1884e7226` |
| Target | `StandaloneWindows64` |
| Addressables package | `1.19.19` |
| Newtonsoft JSON package | `3.0.2` |
| Installed Editor | `6000.6.0f1`, Web module |
| Running Editor / Pipeline / Safe Mode instances | None detected by CLI and Unity process check |

The CLI was installed during this pass. No Editor or project package was installed or upgraded. Opening this project in the installed Unity 6 Editor would introduce a version migration and is outside this continuation. The Unity CLI Pipeline package requires Unity 6; it was not added to this 2021 project.

The adapter check targets .NET Standard 2.1 with C# 9. Unity 2021.3 supports .NET Standard 2.1 assemblies, according to its [versioned API profile documentation](https://docs.unity3d.com/cn/2021.3/Manual/dotnetProfileSupport.html). The local compilation establishes API-level compatibility; it does not establish successful Unity import, full-project compilation, IL2CPP behavior or a device build. The separate console fixture runs on .NET 8 and is not intended for Unity.

## Current scene contract

Compilation links the project's actual `Assets/RpgIntegration/Contracts/*.cs` and `Runtime/SceneServices.cs`; it does not replace or edit those files.

The current contract requires `new SceneLoadRequest(sceneId)` and exposes an immutable `SceneId`. `SceneLoadResult` exposes `Success`, `SceneId` and `Error`. `ISceneLoader.LoadAsync(request, cancellationToken)` returns a task. `SceneLoadCoordinator` links caller cancellation with its configured timeout, passes the request through, and turns loader exceptions or cooperative cancellation into a failed result. Its timeout relies on the underlying loader observing cancellation; it cannot forcibly stop an uncooperative loader.

There are no spawn coordinates, room dimensions or save payloads in this scene-load request. Those responsibilities stay with the existing host. No actual Undertow scene asset, build-settings entry or Addressables registration has been verified or created. Fixture scene names are test values only.

## Adapter behavior

`UndertowSceneAdapter.cs` contains three types:

- `RoomSceneBinding`: an explicit authored room ID, host-approved scene ID and room envelope. Only R01 through R18 are accepted. Surface and Stillwater are not converted into rooms or implicitly mapped to scenes.
- `RoomEnvelope`: finite positive authored dimensions, converted from feet to meters with factor 0.3048. Height, depth and elevation retain separate meanings. These are bounding envelopes, not collision meshes, polygon reconstructions or spawn positions. Preserve the portable pack's authored shape/labels separately when building actual geometry.
- `UndertowSceneAdapter`: captures bindings and a validated pack revision, checks that each action names that revision, rejects unmapped destinations and substituted scene IDs, and delegates explicitly requested loads to the existing coordinator. It passes the host's request and coordinator result through intact.

The host must validate the portable pack with the existing exporter/validator, authorize each action, choose real registered scene IDs, and supply the request factory and existing coordinator. The adapter does not parse untrusted JSON, authenticate a caller, enforce route adjacency, decide GM rulings, manage visibility, update saves or invoke any loader automatically. It must not receive a player-controlled scene binding table. It does not prove that a supplied scene ID is actually registered; that check belongs to the host/Editor integration.

Bindings may cover a subset of rooms; missing bindings fail closed. Multiple rooms may intentionally share a registered scene, with separate room placement handled by the host. No guessed default scene is used.

## Repeat the checks

Run from the canonical Operator project root:

```powershell
dotnet build campaigns/the-unwritten-coast/rehearsal/unity-adapter/Undertow.ContractCheck.csproj --nologo --verbosity minimal

dotnet run --project campaigns/the-unwritten-coast/rehearsal/unity-adapter/fixture/Undertow.Fixture.csproj --verbosity minimal

node --test campaigns/the-unwritten-coast/rehearsal/rehearsal.test.mjs campaigns/the-unwritten-coast/rehearsal/portable.test.mjs
```

The .NET Standard check built with **zero warnings and zero errors**. The console fixture passed **11 checks** covering explicit request identity, unknown room/surface/boundary rejection, revision mismatch, scene substitution and null requests, cancellation before work, loader exceptions, cooperative timeout, caller cancellation, narrow/cavern dimensions and vertical meaning, malformed inputs, and isolation from later changes to the host's binding collection. The **23 existing rehearsal/export tests also passed**.

The recording loader never opens a real scene. Its result is deliberately marked as a fixture failure, and the adapter is checked for preserving that result; passing these tests must not be reported as a successful Unity scene load. Error and cancellation checks assert the actual result fields from the current contracts.

Build outputs remain in this folder and are ignored by its `.gitignore`. `Undertow.ContractCheck.dll` includes linked copies of the project's contract classes for validation only: **do not import that DLL into Unity**, where those types already exist. A future approved installation would place only the adapter source in a correctly referenced assembly and use the project's existing contracts.

## Next bounded milestone

Use the generated portable GM pack in a disposable fixture with explicit test-only scene bindings. Traverse the authored route graph, verify all 18 envelopes and player projections across that traversal, and confirm the GM-controlled boundary is never sent to the ordinary loader. Actual Editor integration and audio optimization remain pending the matching Editor and appropriate project-owner coordination; this pass changes neither live scenes nor live stores.
