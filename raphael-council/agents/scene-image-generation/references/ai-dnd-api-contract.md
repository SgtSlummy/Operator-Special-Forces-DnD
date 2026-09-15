# AI-DnD Image Generation API integration notes

The upstream reference describes a local FastAPI service with an API base of
`http://localhost:8000/api/v1`. Its health endpoint is at the root
`/health`, not `/api/v1/health`. The production image endpoint is
`POST /api/v1/images/generate` with JSON fields:

```json
{
  "subject_type": "location",
  "subject_name": "Saltglass Shore",
  "prompt": "Observable rocky shoreline at low tide, fantasy RPG scene",
  "aspect_ratio": "16:9"
}
```

The documented subject types are `scene`, `character`, `item`, and `location`.
The documented aspect ratios include `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`,
`5:4`, `9:16`, `16:9`, and `21:9`. A successful response may include an
`image_url`, or the scene endpoint may return `image_data` as a data URI. The
Operator DND adapter accepts either form and converts decoded WebP/JPEG data
to PNG before handing it to `SceneImageService`.

The upstream scene convenience endpoint is `POST /api/v1/scenes/generate`.
It accepts `location`, `time_of_day`, and `weather`, and may return a cached
scene. Operator DND currently uses the richer image endpoint because its deck
needs explicit subject type, subject name, prompt, and aspect ratio. A future
scene-cache adapter may use the convenience endpoint, but it must include the
game revision and observable scene ID in its own cache key.

The reference also describes PixelLab MCP tools for pixel-art generation and
animation. Those tools are not silently assumed to exist in this runtime. The
project keeps PixelLab as a future local character-sprite provider boundary;
until its MCP capability is explicitly installed and health-checked, portraits
use the approved library or existing ComfyUI/Obus route.

Security and game rules are project-specific: only localhost service URLs are
accepted, provider credentials stay in the provider process, raw references
are not sent to the Nano Banana adapter because that contract does not define
an upload field, and image completion never mutates game state. If a request
needs approved references, ComfyUI or Obus is selected instead and the route
decision is recorded in the job audit.
