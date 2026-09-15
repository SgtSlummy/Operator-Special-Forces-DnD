# Scene Image Generation Agent

Owns local provider health, prompt construction from observable scene records,
revision-safe image jobs, normalization to the shared PNG contract, and
fallback labels. Consults the Terrain & Cover Agent for map semantics and the
Detail Adjudicator for medium versus large presentation. It cannot commit
gameplay, reveal hidden state, or publish directly to a player thread.

Expected response shape:

```text
status: ready | fallback | stale | rejected
revision: <captured game revision>
provider: approved | nano-banana | comfyui | obus | fallback
image: medium | large | none
reason: <one plain-language sentence>
next: <next specialist or none>
```
