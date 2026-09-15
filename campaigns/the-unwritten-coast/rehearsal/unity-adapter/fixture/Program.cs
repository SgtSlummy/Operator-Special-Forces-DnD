using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RpgIntegration.Contracts;
using RpgIntegration.Runtime;
using UnwrittenCoast.Rehearsal;

internal static class Program
{
    private static readonly string Revision = new string('a', 64);
    private static int _checks;

    private static async Task Main()
    {
        Console.WriteLine("Current SceneLoadRequest properties: " + string.Join(", ", typeof(SceneLoadRequest).GetProperties().Select(p => p.Name + ":" + p.PropertyType.Name)));
        Console.WriteLine("Current SceneLoadResult properties: " + string.Join(", ", typeof(SceneLoadResult).GetProperties().Select(p => p.Name + ":" + p.PropertyType.Name)));

        await Check("explicit scene binding reaches existing coordinator with the host request intact", async () => {
            var loader = new RecordingLoader();
            SceneLoadRequest request = null;
            var adapter = Make(loader, id => request = new SceneLoadRequest(id));
            var result = await adapter.LoadRoomAsync("R01", Revision, CancellationToken.None);
            Require(ReferenceEquals(result, loader.Result), "Coordinator result must be preserved.");
            Require(ReferenceEquals(request, loader.LastRequest), "Host request must be passed intact.");
            Require(loader.LastRequest.SceneId == "fixture-entry", "Room ID must not be used as a scene ID.");
        });
        await Check("unmapped rooms and special boundary never invoke the request factory", () => {
            int calls = 0;
            var adapter = Make(new RecordingLoader(), id => { calls++; return new SceneLoadRequest(id); });
            foreach (string room in new[] { "R02", "surface", "Stillwater", "R99", "r01", "", null })
                Throws<ArgumentException>(() => adapter.LoadRoomAsync(room, Revision, CancellationToken.None));
            Require(calls == 0, "Unmapped destinations reached the factory.");
            return Task.CompletedTask;
        });
        await Check("atlas revision mismatch fails before loading", () => {
            var loader = new RecordingLoader();
            var adapter = Make(loader);
            Throws<InvalidOperationException>(() => adapter.LoadRoomAsync("R01", new string('b', 64), CancellationToken.None));
            Require(loader.Calls == 0, "Mismatched atlas loaded.");
            return Task.CompletedTask;
        });
        await Check("factory cannot substitute a different scene or null request", () => {
            foreach (var factory in new Func<string, SceneLoadRequest>[] { id => null, id => new SceneLoadRequest("wrong-scene") })
            {
                var loader = new RecordingLoader();
                Throws<InvalidOperationException>(() => Make(loader, factory).LoadRoomAsync("R01", Revision, CancellationToken.None));
                Require(loader.Calls == 0, "Substituted scene reached loader.");
            }
            return Task.CompletedTask;
        });
        await Check("already-cancelled action never invokes request factory or loader", async () => {
            int factoryCalls = 0;
            var loader = new RecordingLoader();
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            var adapter = Make(loader, id => { factoryCalls++; return new SceneLoadRequest(id); });
            await ThrowsAsync<OperationCanceledException>(() => adapter.LoadRoomAsync("R01", Revision, cancellation.Token));
            Require(factoryCalls == 0 && loader.Calls == 0, "Cancelled request caused work.");
        });
        await Check("loader exception is converted by the existing coordinator", async () => {
            var loader = new RecordingLoader { Throw = true };
            var result = await Make(loader).LoadRoomAsync("R01", Revision, CancellationToken.None);
            Require(result != null && !result.Success && result.SceneId == "fixture-entry" && result.Error == "fixture load failure" && loader.Calls == 1, "Expected coordinator failure result with original scene and error.");
        });
        await Check("cooperative timeout returns through existing coordinator", async () => {
            var loader = new RecordingLoader { Wait = true };
            var adapter = Make(loader, timeout: TimeSpan.FromMilliseconds(25));
            Task<SceneLoadResult> operation = adapter.LoadRoomAsync("R01", Revision, CancellationToken.None);
            Require(await Task.WhenAny(operation, Task.Delay(3000)) == operation, "Timeout did not settle.");
            var result = await operation;
            Require(!result.Success && result.SceneId == "fixture-entry" && result.Error == "Scene load timed out or was cancelled." && loader.CancellationObserved, "Cancellation did not produce the expected failure result.");
        });
        await Check("cooperative caller cancellation reaches the existing loader", async () => {
            var loader = new RecordingLoader { Wait = true };
            using var cancellation = new CancellationTokenSource();
            var operation = Make(loader).LoadRoomAsync("R01", Revision, cancellation.Token);
            cancellation.Cancel();
            var result = await operation;
            Require(!result.Success && result.SceneId == "fixture-entry" && result.Error == "Scene load timed out or was cancelled." && loader.CancellationObserved, "Caller cancellation did not settle through coordinator.");
        });
        await Check("narrow and cavern envelopes preserve real scale and vertical meaning", () => {
            var narrow = new RoomSceneBinding("R02", "fixture-narrow", 4, 6, 5, "height").Envelope;
            var cavern = new RoomSceneBinding("R15", "fixture-cavern", 1600, 900, 220, "height").Envelope;
            var well = new RoomSceneBinding("R03", "fixture-well", 12, 12, 160, "depth").Envelope;
            var catwalk = new RoomSceneBinding("R08", "fixture-catwalk", 180, 15, 70, "elevation").Envelope;
            Near(narrow.WidthMeters, 1.2192);
            Near(cavern.WidthMeters, 487.68);
            Near(cavern.DepthMeters, 274.32);
            Near(well.VerticalMeters, 48.768);
            Require(well.VerticalKind == "depth" && catwalk.VerticalKind == "elevation", "Vertical semantics changed.");
            return Task.CompletedTask;
        });
        await Check("malformed bindings, dimensions and revision are rejected", () => {
            foreach (double value in new[] { 0, -1, double.NaN, double.PositiveInfinity, 10000001 })
                Throws<ArgumentOutOfRangeException>(() => new RoomSceneBinding("R01", "fixture", value, 5, 5, "height"));
            Throws<ArgumentException>(() => new RoomSceneBinding("R19", "fixture", 5, 5, 5, "height"));
            Throws<ArgumentException>(() => new RoomSceneBinding("R01", "\n", 5, 5, 5, "height"));
            Throws<ArgumentException>(() => new RoomSceneBinding("R01", "fixture", 5, 5, 5, "guess"));
            Throws<ArgumentException>(() => new UndertowSceneAdapter("old", Bindings(), Coordinator(new RecordingLoader()), id => new SceneLoadRequest(id)));
            var duplicates = new[] { Bindings()[0], Bindings()[0] };
            Throws<ArgumentException>(() => new UndertowSceneAdapter(Revision, duplicates, Coordinator(new RecordingLoader()), id => new SceneLoadRequest(id)));
            return Task.CompletedTask;
        });
        await Check("host collection changes cannot replace approved bindings", async () => {
            var bindings = Bindings();
            var loader = new RecordingLoader();
            var adapter = new UndertowSceneAdapter(Revision, bindings, Coordinator(loader), id => new SceneLoadRequest(id));
            bindings[0] = new RoomSceneBinding("R01", "changed-after-approval", 1, 1, 1, "height");
            await adapter.LoadRoomAsync("R01", Revision, CancellationToken.None);
            Require(loader.LastRequest.SceneId == "fixture-entry", "Mutable binding list changed adapter state.");
        });
        _checks += await PackFixture.RunAsync(Environment.GetCommandLineArgs().Skip(1).ToArray());
        Console.WriteLine($"PASS: {_checks} adapter checks; real project contracts linked; no Unity Editor or scene was opened.");
    }

    private static RoomSceneBinding[] Bindings() => new[] { new RoomSceneBinding("R01", "fixture-entry", 20, 30, 10, "height") };
    private static SceneLoadCoordinator Coordinator(ISceneLoader loader, TimeSpan? timeout = null) => new SceneLoadCoordinator(loader, timeout ?? TimeSpan.FromSeconds(5));
    private static UndertowSceneAdapter Make(ISceneLoader loader, Func<string, SceneLoadRequest> factory = null, TimeSpan? timeout = null) => new UndertowSceneAdapter(Revision, Bindings(), Coordinator(loader, timeout), factory ?? (id => new SceneLoadRequest(id)));
    private static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Near(double actual, double expected) => Require(Math.Abs(actual - expected) < 0.0000001, $"Expected {expected}, got {actual}.");
    private static void Throws<T>(Action action) where T : Exception { try { action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
    private static async Task ThrowsAsync<T>(Func<Task> action) where T : Exception { try { await action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
    private static async Task Check(string name, Func<Task> action) { await action(); _checks++; Console.WriteLine("PASS " + name); }

    private sealed class RecordingLoader : ISceneLoader
    {
        public int Calls;
        public bool Throw;
        public bool Wait;
        public bool CancellationObserved;
        public SceneLoadRequest LastRequest;
        public SceneLoadResult Result;
        public async Task<SceneLoadResult> LoadAsync(SceneLoadRequest request, CancellationToken cancellationToken)
        {
            Calls++;
            LastRequest = request;
            if (Throw) throw new InvalidOperationException("fixture load failure");
            if (Wait)
            {
                try { await Task.Delay(Timeout.Infinite, cancellationToken); }
                catch (OperationCanceledException) { CancellationObserved = true; throw; }
            }
            Result = SceneLoadResult.Failed(request.SceneId, "fixture result; no real scene loaded");
            return Result;
        }
    }
}
