using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using RpgIntegration.Contracts;
using RpgIntegration.Runtime;
using UnwrittenCoast.Rehearsal;

// Disposable contract exercise: these scene IDs and this loader are fixture-only.
internal static class PackFixture
{
    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("SKIP full-pack checks: supply absolute GM pack and opening player export paths.");
            return 0;
        }
        Require(args.Length == 2 && args.All(Path.IsPathFullyQualified),
            "Expected two absolute paths: GM pack JSON, opening player JSON.");
        using var gmDocument = JsonDocument.Parse(await File.ReadAllTextAsync(args[0]));
        using var playerDocument = JsonDocument.Parse(await File.ReadAllTextAsync(args[1]));
        var pack = gmDocument.RootElement;
        var player = playerDocument.RootElement;
        Require(pack.GetProperty("schemaVersion").GetInt32() == 1 && Text(pack, "audience") == "gm",
            "Expected the version-1 GM pack.");
        Require(Text(pack, "packId") == "unwritten-coast-undertow" && Text(pack, "entryRoomId") == "R01",
            "Unexpected pack or entry room.");
        var revision = Text(pack, "sourceRevision");
        var rooms = pack.GetProperty("rooms").EnumerateArray().ToDictionary(room => Text(room, "id"));
        Require(rooms.Keys.ToHashSet().SetEquals(Enumerable.Range(1, 18).Select(i => $"R{i:00}")),
            "Expected all 18 unique authored rooms.");
        var routes = pack.GetProperty("routes").EnumerateArray().ToArray();
        Require(routes.Length == 25 && routes.Select(route => Text(route, "id")).Distinct().Count() == 25,
            "Expected 25 unique ordinary passages.");
        Pass("actual portable pack contains all 18 rooms and 25 passages");

        var bindings = rooms.Select(pair => {
            var scale = pair.Value.GetProperty("scale");
            return new RoomSceneBinding(pair.Key, SceneId(pair.Key), Number(scale, "widthFeet"),
                Number(scale, "depthFeet"), Number(scale, "verticalFeet"), Text(scale, "verticalKind"));
        }).ToArray();
        var loader = new FixtureLoader();
        var adapter = new UndertowSceneAdapter(revision, bindings,
            new SceneLoadCoordinator(loader, TimeSpan.FromSeconds(5)), id => new SceneLoadRequest(id));
        foreach (var pair in rooms)
        {
            var scale = pair.Value.GetProperty("scale");
            var envelope = adapter.GetEnvelope(pair.Key);
            Near(envelope.WidthMeters, Number(scale, "widthFeet") * 0.3048);
            Near(envelope.DepthMeters, Number(scale, "depthFeet") * 0.3048);
            Near(envelope.VerticalMeters, Number(scale, "verticalFeet") * 0.3048);
            Require(envelope.VerticalKind == Text(scale, "verticalKind"), "Vertical meaning changed.");
        }
        Near(adapter.GetEnvelope("R02").WidthMeters, 1.2192);
        Near(adapter.GetEnvelope("R15").WidthMeters, 487.68);
        Pass("all 18 real room envelopes preserve scale, including the 4 ft slot and 1600 ft cavern");

        int directions = 0;
        int surfaceExits = 0;
        var adjacency = rooms.Keys.ToDictionary(id => id, id => new HashSet<string>());
        foreach (var route in routes)
        {
            Require(route.GetProperty("bidirectional").GetBoolean(), "An ordinary passage lost its reverse direction.");
            var from = Text(route, "from");
            var to = Text(route, "to");
            Require((rooms.ContainsKey(from) || from == "surface") && (rooms.ContainsKey(to) || to == "surface"),
                "Ordinary passage contains a special or unknown destination.");
            Require(from != to, "Self-loop is not an authored passage.");
            if (rooms.ContainsKey(from) && rooms.ContainsKey(to))
            {
                adjacency[from].Add(to);
                adjacency[to].Add(from);
            }
            foreach (var destination in new[] { to, from })
            {
                directions++;
                int before = loader.Calls;
                if (destination == "surface")
                {
                    await RejectAsync<ArgumentException>(() => adapter.LoadRoomAsync(destination, revision, CancellationToken.None));
                    Require(loader.Calls == before, "Unbound surface exit reached the loader.");
                    surfaceExits++;
                    continue;
                }
                var result = await adapter.LoadRoomAsync(destination, revision, CancellationToken.None);
                Require(loader.Calls == before + 1 && loader.LastSceneId == SceneId(destination),
                    "An ordinary direction used the wrong explicit scene binding.");
                Require(ReferenceEquals(result, loader.LastResult), "Coordinator result was replaced.");
            }
        }
        Require(directions == 50 && loader.Calls == 48 && surfaceExits == 2,
            "Expected 48 mapped room requests and two unbound surface exits.");
        Pass("all 25 passages exercised both ways: 48 mapped requests and two explicit surface exit rejections");

        var reachable = new HashSet<string> { "R01" };
        var queue = new Queue<string>();
        queue.Enqueue("R01");
        while (queue.Count > 0)
            foreach (var next in adjacency[queue.Dequeue()])
                if (next != "R02" && reachable.Add(next)) queue.Enqueue(next);
        Require(reachable.Contains("R16") && !reachable.Contains("R02"),
            "The signal tower must remain reachable without the optional service slot.");
        Require(routes.Any(route => new[] { Text(route, "from"), Text(route, "to") }.ToHashSet().SetEquals(new[] { "R16", "surface" })),
            "The signal tower surface exit is missing.");
        Pass("the ordinary entry-to-signal-tower route remains available without the optional narrow slot");

        var boundaries = pack.GetProperty("boundaries").EnumerateArray().ToArray();
        Require(boundaries.Length == 1 && Text(boundaries[0], "name") == "Stillwater" &&
            boundaries[0].GetProperty("requiresGmRuling").GetBoolean(), "The authored GM boundary changed.");
        int callsBeforeBoundary = loader.Calls;
        await RejectAsync<ArgumentException>(() => adapter.LoadRoomAsync("Stillwater", revision, CancellationToken.None));
        await RejectAsync<InvalidOperationException>(() => adapter.LoadRoomAsync("R01", new string('0', 64), CancellationToken.None));
        Require(loader.Calls == callsBeforeBoundary, "Special boundary or wrong revision reached the loader.");
        Pass("Stillwater and a mismatched atlas revision never reach ordinary scene loading");

        Keys(player, "schemaVersion", "kind", "audience", "packId", "sourceRevision", "currentRoomId", "rooms", "routes");
        Require(player.GetProperty("schemaVersion").GetInt32() == 1 && Text(player, "kind") == "undertow-player-view" &&
            Text(player, "audience") == "player" && Text(player, "packId") == Text(pack, "packId") &&
            Text(player, "sourceRevision") == revision && Text(player, "currentRoomId") == "R01",
            "Opening projection identity or revision is wrong.");
        var visibleRooms = player.GetProperty("rooms").EnumerateArray().ToArray();
        Require(visibleRooms.Length == 1 && Text(visibleRooms[0], "id") == "R01" &&
            player.GetProperty("routes").GetArrayLength() == 0, "Opening export reveals undisclosed rooms or routes.");
        Keys(visibleRooms[0], "id", "name", "arrival");
        Require(Text(visibleRooms[0], "name") == Text(rooms["R01"], "name") &&
            Text(visibleRooms[0], "arrival") == Text(rooms["R01"], "arrival"), "Opening room text does not match the pack.");
        Pass("actual opening player export contains only the approved entry description; no GM fields or undisclosed routes");
        return 6;
    }

    private static string SceneId(string roomId) => "fixture-undertow-" + roomId.ToLowerInvariant();
    private static string Text(JsonElement value, string key) => value.GetProperty(key).GetString();
    private static double Number(JsonElement value, string key) => value.GetProperty(key).GetDouble();
    private static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Near(double actual, double expected) => Require(Math.Abs(actual - expected) < 0.0000001, $"Expected {expected}, got {actual}.");
    private static void Keys(JsonElement value, params string[] allowed) => Require(
        value.EnumerateObject().Select(property => property.Name).OrderBy(name => name).SequenceEqual(allowed.OrderBy(name => name)),
        "Projection has missing, duplicate, or unapproved fields.");
    private static void Pass(string message) => Console.WriteLine("PASS " + message);
    private static async Task RejectAsync<T>(Func<Task<SceneLoadResult>> action) where T : Exception
    {
        try { await action(); }
        catch (T) { return; }
        throw new Exception("Expected " + typeof(T).Name);
    }

    private sealed class FixtureLoader : ISceneLoader
    {
        public int Calls;
        public string LastSceneId;
        public SceneLoadResult LastResult;
        public Task<SceneLoadResult> LoadAsync(SceneLoadRequest request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls++;
            LastSceneId = request.SceneId;
            // Deliberately report no real load. Success here would misrepresent this fixture's scope.
            LastResult = SceneLoadResult.Failed(request.SceneId, "disposable fixture; no Unity scene loaded");
            return Task.FromResult(LastResult);
        }
    }
}
