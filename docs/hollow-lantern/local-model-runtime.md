# Local visual rehearsal runtime

On 2026-09-09, three screenshot requests had timed out at 80 seconds. Ollama metadata endpoints still answered in 14–42 ms, but the RTX 3090 held 23,975 of 24,576 MiB and remained at 100% utilization after canceled requests. The active 27B model inherited a 65,536-token context; its reported GPU allocation was 20,728,323,766 bytes. The Stable Diffusion API reported no active job.

## Measured recovery

1. Confirmed Stable Diffusion idle: `job_count: 0`, empty `job`, progress zero.
2. Called its installed documented `POST http://127.0.0.1:7860/sdapi/v1/unload-checkpoint`. It returned HTTP 200 in 2,959 ms. GPU usage fell to 21,758 MiB.
3. Sent a bounded text health request to the existing Ollama model with a per-request 4,096-token context. It returned `READY` in 20,667 ms, including 20,176 ms model loading.
4. Sent the original full-resolution 1280×1000 screenshot, without resizing or cropping. Vision returned an accurate description of the loading screen in 3,659 ms: 1,274 prompt tokens and 53 output tokens. This proves provider responsiveness, not gameplay comprehension.
5. Ollama then reported context length 4,096 and GPU allocation 16,638,877,366 bytes. A subsequent GPU reading was 18,427 MiB and 24% utilization.

Both unloading the idle art checkpoint and reducing the request context were applied before the successful vision test. These measurements do not isolate either change's individual causal contribution.

## Request settings

The measured vision request used `POST http://127.0.0.1:11434/api/chat` with:

```json
{
  "model": "obus-qwen3.8-27b:65k",
  "stream": false,
  "think": false,
  "keep_alive": "5m",
  "messages": [{
    "role": "user",
    "content": "Describe only what is visibly shown in this screenshot in at most 40 words. Do not infer hidden content.",
    "images": ["<original PNG bytes encoded as base64>"]
  }],
  "options": {"num_ctx": 4096, "num_predict": 100, "temperature": 0}
}
```

The diagnostic request timeout was 45 seconds. The interactive rehearsal can retain its 180-token output bound while explicitly setting `num_ctx: 4096`; it should serialize GPU vision requests and keep participant screenshots readable. These are disposable rehearsal request settings, not a global model update. No service was killed or restarted, and no model files were modified.

## Art checkpoint recovery

The idle art checkpoint is intentionally left unloaded while the blind rehearsal window is running. After that window, the installed API exposes `POST http://127.0.0.1:7860/sdapi/v1/reload-checkpoint`. Coordinate the reload with other GPU users, then verify an actual art request before claiming generation works. Whether the next normal generation automatically reloads the checkpoint has not been tested; do not assume it.

The installed implementation declares both routes in `C:\Users\Hermes\stable-diffusion-webui\modules\api\api.py`. Do not stop services or unload a checkpoint while an art job is active.

Machine-readable evidence: `C:\Users\Hermes\LocalFiles\hollow-lantern\validation\runtime-performance.json`, with the original diagnostic copy under `provider-diagnosis-20260909\evidence.json`. No credentials or live campaign data are included.

## Graceful AI lease release: source ready, private-worker rollout pending

The signed compare-and-swap host-release endpoint and matching client are implemented and tested. Release checks the boot identity, generation, and policy revision; a stale closing host cannot revoke its replacement. Successful release clears the owning master lease and revokes child dispatches, allowing an immediate clean restart. Disabling a policy alone does not release its lease.

The existing private Obus worker on port 38178 (PID 8032 at the attempted rollout) still runs the older route implementation. Automatic approval review rejected the supervised stop/restart action with only “blocked by policy”; no detailed reason was supplied and the action did not execute. No alternative stop route was attempted. The source fix therefore remains awaiting a separately authorized private-worker reload. Core port 38173, model services, and live campaign data were not changed.

Until that worker is updated, the client fails safely to disabling its own policy and reports that clean lease release is unavailable; disabled must not be interpreted as released. An immediate replacement can remain denied until the existing lease expires. The supervising task restored Davy after expiry; this is not evidence that the new release endpoint has been loaded.


On 2026-09-09 after the isolated browser trials ended, the idle SD checkpoint reload returned200 and fixture-art-run.mjs completed a real signed local request through Obus. Provider receipt: model6ce0161689,512×512,24 steps,SHA52363e05d2ac87ec4fb0e30c2531c56bdcd608a241c8a4cded10f44a3f696f66. Candidate57fc3b31-b54d-44cf-b716-31855539437a remains private and was not selected for deployment because its modern room framing did not fit the intended setting. Existing approved art was unchanged. The27B vision model was not unloaded or globally reconfigured.
