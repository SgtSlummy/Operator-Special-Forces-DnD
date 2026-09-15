using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using RpgIntegration.Contracts;
using RpgIntegration.Runtime;

namespace UnwrittenCoast.Rehearsal
{
    // Host-owned bindings only. This is not a player authorization or travel-rules layer.
    public sealed class RoomSceneBinding
    {
        public string RoomId { get; }
        public string SceneId { get; }
        public RoomEnvelope Envelope { get; }

        public RoomSceneBinding(string roomId, string sceneId, double widthFeet, double depthFeet,
            double verticalFeet, string verticalKind)
        {
            if (roomId == null || !Regex.IsMatch(roomId, @"\AR(?:0[1-9]|1[0-8])\z"))
                throw new ArgumentException("Expected an authored Undertow room R01 through R18.", nameof(roomId));
            if (string.IsNullOrWhiteSpace(sceneId) || sceneId.Length > 200)
                throw new ArgumentException("An explicit registered scene ID is required.", nameof(sceneId));
            foreach (char character in sceneId)
                if (char.IsControl(character)) throw new ArgumentException("Scene ID contains control characters.", nameof(sceneId));
            RoomId = roomId;
            SceneId = sceneId;
            Envelope = new RoomEnvelope(widthFeet, depthFeet, verticalFeet, verticalKind);
        }
    }

    // Dimensions are bounding envelopes, not collision meshes or spawn coordinates.
    public sealed class RoomEnvelope
    {
        public const double MetersPerFoot = 0.3048;
        public double WidthMeters { get; }
        public double DepthMeters { get; }
        public double VerticalMeters { get; }
        public string VerticalKind { get; }

        public RoomEnvelope(double widthFeet, double depthFeet, double verticalFeet, string verticalKind)
        {
            ValidateFeet(widthFeet, nameof(widthFeet));
            ValidateFeet(depthFeet, nameof(depthFeet));
            ValidateFeet(verticalFeet, nameof(verticalFeet));
            if (verticalKind != "height" && verticalKind != "depth" && verticalKind != "elevation")
                throw new ArgumentException("Preserve the authored height, depth or elevation qualifier.", nameof(verticalKind));
            WidthMeters = widthFeet * MetersPerFoot;
            DepthMeters = depthFeet * MetersPerFoot;
            VerticalMeters = verticalFeet * MetersPerFoot;
            VerticalKind = verticalKind;
        }

        private static void ValidateFeet(double value, string field)
        {
            if (double.IsNaN(value) || double.IsInfinity(value) || value <= 0 || value > 10000000)
                throw new ArgumentOutOfRangeException(field, "Dimension must be finite, positive and bounded.");
        }
    }

    public sealed class UndertowSceneAdapter
    {
        private readonly Dictionary<string, RoomSceneBinding> _bindings;
        private readonly SceneLoadCoordinator _coordinator;
        private readonly Func<string, SceneLoadRequest> _requestFactory;
        public string SourceRevision { get; }

        public UndertowSceneAdapter(string sourceRevision, IEnumerable<RoomSceneBinding> bindings,
            SceneLoadCoordinator coordinator, Func<string, SceneLoadRequest> requestFactory)
        {
            if (sourceRevision == null || !Regex.IsMatch(sourceRevision, @"\A[0-9a-f]{64}\z"))
                throw new ArgumentException("A validated portable pack revision is required.", nameof(sourceRevision));
            if (bindings == null) throw new ArgumentNullException(nameof(bindings));
            _coordinator = coordinator ?? throw new ArgumentNullException(nameof(coordinator));
            _requestFactory = requestFactory ?? throw new ArgumentNullException(nameof(requestFactory));
            SourceRevision = sourceRevision;
            _bindings = new Dictionary<string, RoomSceneBinding>(StringComparer.Ordinal);
            foreach (RoomSceneBinding binding in bindings)
            {
                if (binding == null) throw new ArgumentException("Null binding.", nameof(bindings));
                if (_bindings.ContainsKey(binding.RoomId)) throw new ArgumentException("Duplicate room binding.", nameof(bindings));
                _bindings.Add(binding.RoomId, binding);
            }
        }

        public RoomEnvelope GetEnvelope(string roomId)
        {
            return RequireBinding(roomId).Envelope;
        }

        // The host must authorize this action and select a real scene catalog entry.
        // Spawn and save handling stay in the host; SceneLoadRequest carries only SceneId.
        // No scene ID is inferred from a room name or ID.
        public Task<SceneLoadResult> LoadRoomAsync(string roomId, string expectedRevision, CancellationToken cancellationToken)
        {
            if (!string.Equals(SourceRevision, expectedRevision, StringComparison.Ordinal))
                throw new InvalidOperationException("The requested atlas revision does not match this adapter.");
            RoomSceneBinding binding = RequireBinding(roomId);
            if (cancellationToken.IsCancellationRequested)
                return Task.FromCanceled<SceneLoadResult>(cancellationToken);
            SceneLoadRequest request = _requestFactory(binding.SceneId);
            if (request == null || !string.Equals(request.SceneId, binding.SceneId, StringComparison.Ordinal))
                throw new InvalidOperationException("The host request must retain the explicitly bound scene ID.");
            return _coordinator.LoadAsync(request, cancellationToken);
        }

        private RoomSceneBinding RequireBinding(string roomId)
        {
            RoomSceneBinding binding;
            if (roomId == null || !_bindings.TryGetValue(roomId, out binding))
                throw new ArgumentException("This room has no approved scene binding.", nameof(roomId));
            return binding;
        }
    }
}
