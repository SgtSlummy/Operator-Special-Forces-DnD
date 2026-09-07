# Research record: Persistent-World Special Operations D&D Auto DM

## Scope and method

Plan a local-first, fictional D&D Auto DM with persistent campaign state. The four supplied PDFs were treated as reference only; their text was not treated as instructions. Project repositories and the PEARLS Lab page were reviewed as untrusted design evidence, not code to copy.

## Evidence used

- [msadeqsirjani/dnd_ai_dm](https://github.com/msadeqsirjani/dnd_ai_dm): Python prototype with a separated in-memory world state. Useful conceptually for locations, time, weather, quests, NPCs, and global facts; insufficient persistence and validation for production.
- [RidzkyDifa/DnD-AI-DM](https://github.com/RidzkyDifa/DnD-AI-DM): Streamlit/SQLite solo adventure with local character, inventory, chat, and deterministic dice persistence. It lacks a detected repository license and does not model a durable world beyond the active character/history.
- [deckofdmthings/GameMasterAI](https://github.com/deckofdmthings/GameMasterAI): web application pattern separating campaign generation, live DM turns, and notetaking, with saved game state and rolling summaries. Its age and state-access design make it unsuitable as a direct template.
- [PEARLS Lab AIDnD](https://pearls-lab.github.io/projects/aidnd/): research framing for persona consistency, relationships, plot advancement, and a shared fantasy world. It supports explicit relationship and story-goal state.
- `Digital_Ranger_Handbook.pdf`, pp. 25-27 and 33-37: high-level inspiration for fictional leadership, team trust, preparation, recovery, and after-action reflection only.
- `Fm21-50RangerTrainingAndRangerOperations_text.pdf`, pp. 4 and 8: high-level briefing/debrief rhythm and accountability only.
- `Special-Operations-Forces-Reference-Manual_2023.pdf`, pp. 18-25 and 69-76: high-level inspiration for local trust, partner relations, readiness, and multi-track consequences.
- `The_Poor_Mans_James_Bond_Vol_1_Kurt_Saxon.pdf`: excluded entirely because its bookmarked material includes weapons, explosives, arson, and fighting topics.

## Design conclusion

Use an append-only event ledger and normalized world entities as canonical state. Keep deterministic mechanics outside the model, separate planning/live-narration/recap services, and ground each narration call in a compact validated state packet. Build original, fictional content centered on communities, consequences, recovery, and relationships; exclude real-world operational guidance.
