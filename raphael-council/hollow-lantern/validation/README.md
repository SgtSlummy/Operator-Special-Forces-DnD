# Isolated visual rehearsal

This is a bounded, screenshot-only trial using fresh simulated participants. Development agents are not counted as blind testers. No game actions, browser clicks, Discord sessions, or full campaign acceptance are claimed.

Run `node hollow-lantern/validation/harness.mjs <walkthrough-directory> <local-evidence-root>`. The source directory must contain the actual Unity-projection JSON and corresponding PNG pairs named `01-initial-<participant>` and `03-movement-<participant>` for `lantern-fighter`, `lantern-rogue`, `lantern-cleric`, and `gm`. The JSON stays in the trusted controller. Only two scoped screenshots and an ordinary observation task enter each participant.

Each participant starts a new `node:24.17.0-bookworm-slim` container with network disabled, read-only root, all capabilities dropped, no-new-privileges, non-root identity, 64-process/256-MB limits, no bind mounts, and no proxy/environment credential forwarding. Screenshots enter standard input; the participant has no project mount, engine store, evaluator file, shared history, credential, or retrieval tool. Actual container inspection and write/network probes are saved before inference; failed isolation stops that participant without a model request.

The trusted controller transports the participant's single message to fixed local Ollama `127.0.0.1:11434`, model `obus-qwen3.8-27b:65k`, without tools or retrieval. Responses return only to that participant process. Model weights and the serving process are shared; per-request prompts and histories are separate. This does not establish separate model-serving processes or browser profiles.

The model reads before/after coordinates and fog visibility from screenshots. Controller expectations come from the corresponding audience-filtered projection, using the image's one-based coordinate labels. The expected answers are never included in model messages. Unknown answers and incorrect coordinates fail. A maximum of four participants run, each bounded to three minutes and one inference; two failures stop remaining trials. There are no automatic gameplay actions or answer retries. Participant containers are removed at completion or failure.

Evidence directories contain controller-only expectations, hashes and revision provenance, participant input descriptions, actual process/files/network isolation proof, raw model answers, inference counts, and verdicts. Inputs are local PNGs rendered from actual Unity projections, **not real Discord captures**. The initial run with a whitespace/code-fence parser defect remains preserved; the parser fix has a regression test and later trials use new participant processes.

Remaining acceptance: ordinary Discord/browser controls, separate authenticated browser sessions, live participant channels, complete mission traversal, and resulting authoritative action receipts. The current harness does not claim those capabilities.
