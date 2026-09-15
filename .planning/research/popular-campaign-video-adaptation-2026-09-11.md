# Popular campaign videos → a playable Behind the Veil opening

Date: 2026-09-11, America/Los_Angeles

Status: Research and original, GM-run rehearsal material. Not installed in the game, not established campaign history, and not a completed playtest. The user wrote “campg videos”; this report provisionally interprets that as D&D campaign/actual-play videos. A CRPG-gameplay interpretation would require a different comparison.

## Recommendation

Use Critical Role Campaign 2 as the main reference for party chemistry, Fantasy High for concise personal introductions, and Calamity for an immediate, intriguing problem. Adapt those techniques into a short Saltglass Shore mission that players can resolve in several ways. View counts establish reach within this sample; they do not establish why an episode succeeded or prove that its techniques will work in this project.

## What the project review supports

This was a focused review of documented readiness, retrieved project decisions and the active editing board, not an exhaustive source-code audit or a fresh runtime test.

- The directly read [current acceptance status](../../CURRENT_ACCEPTANCE_STATUS.md), dated 2026-09-09, records implemented and previously tested tactical/world/council, Discord, character, imagery, storyboard/music, hosting and recovery work. Browser /play serving was previously verified. These are recorded results, not tests run for this report.
- The same source still requires a GM and two participating accounts to complete an authored mission across Discord Activity and web, with voice, consent/corrections, restart and matching state. It records unverified production endpoint readiness and a Davy deployment where Chronicle was not enabled. Those historical observations require fresh checks before a live session; this report does not assert their present runtime state.
- MemPalace retrieval from [PROJECT_RECOVERY_PLAN.md](../../PROJECT_RECOVERY_PLAN.md), filed 2026-09-09, describes Behind the Veil around Saltglass Shore, a courier rescue, a patrol, an Abbey and a debrief, with exploration, negotiation, relationships, consequences and save/resume. This is retrieved planning context, not a newly inspected source revision.
- That retrieved plan keeps mechanical and player-decision authority out of AI recommendations. Existing imagery remains usable without generation; illustrations must not reveal hidden state or imply unearned outcomes.
- The current Coordinator board has active work on tactical/area-map presentation and game readiness, including Hollow Lantern/Unity/Discord interfaces. Claims show work scope, not delivery evidence. This report adds one research document without altering those files.

Assessment: the useful next proof is an understandable, enjoyable mission using the existing systems. A new rendering stack or broader automation is not supported by this review. The rehearsal below is a concrete content starting point; production readiness remains a separate acceptance task.

## Popularity comparison

Method: live public YouTube search metadata retrieved with yt-dlp on 2026-09-11. Searches covered Critical Role campaign openings, Dimension 20 openings and celebrity D&D sessions. The table ranks six prominent campaign premieres found in that bounded sample by cumulative public video views. It is not an exhaustive global chart, a trending ranking, a unique-viewer count, or a comparison of total franchise audiences. Older uploads have had longer to accumulate views. Counts change; cached search-engine counts differed from the direct YouTube search response.

| Rank in this six-video set | Official upload | Views observed | Runtime | Reference role |
|---|---|---:|---:|---|
| 1 | [Arrival at Kraghammer — Vox Machina E1, Geek & Sundry](https://www.youtube.com/watch?v=i-p9lWIhcLQ) | 26,401,737 | 3:03:35 | Established party with a clear mission and a larger danger |
| 2 | [Curious Beginnings — The Mighty Nein E1, Geek & Sundry](https://www.youtube.com/watch?v=byva0hOj8CU) | 23,660,643 | 3:24:32 | Main reference: character introductions through interaction |
| 3 | [The Draw of Destiny — Campaign 3 E1, Critical Role](https://www.youtube.com/watch?v=P8pLvV3FjPc) | 14,706,676 | 3:58:25 | Popularity comparator; no scene-level analysis in this pass |
| 4 | [The Beginning Begins — Fantasy High E1, Dimension 20](https://www.youtube.com/watch?v=_zZxCVBi7-k) | 8,448,765 | 1:53:58 | Personal spotlights and brisk transitions |
| 5 | [The Fall of Thjazi Fang — Campaign 4 E1, Critical Role](https://www.youtube.com/watch?v=3Mbynm0pGX0) | 6,861,734 | 4:27:48 | Popularity comparator; no scene-level analysis in this pass |
| 6 | [Excelsior — Exandria Unlimited: Calamity E1, Critical Role](https://www.youtube.com/watch?v=KlIkkeWmVvA) | 6,367,903 | 4:10:47 | Specific sensory detail, personal stakes and an unsettling question |

Other sampled results included Escape from the Bloodkeep E1 (3,119,880), A Crown of Candy E1 (1,861,152), The Ravening War E1 (944,623), D&Diesel extended (5,881,409) and Stephen Colbert’s 2019 adventure (3,030,108). Celebrity interviews, unofficial reuploads and one-shots were excluded from the campaign-premiere table. No video was downloaded or rehosted.

## Start with these three short excerpts

English caption files were successfully retrieved for the three videos below. The observations are based on inspected transcript excerpts, not a claim to have watched every episode or analyzed cinematography. Links seek to the beginning of each suggested sample. They contain opening-episode spoilers.

1. **[Curious Beginnings, 30:00–33:00](https://www.youtube.com/watch?v=byva0hOj8CU&t=1800s).** A returning NPC approaches a table and the GM invites players to describe their characters during that social encounter. Players add humor and respond to each other. Observation confidence: high, directly supported by captions. Adaptation: introduce each operator through something another character notices and an existing relationship; keep biographies available on demand. Whether this improves engagement is a design hypothesis.
2. **[Fantasy High, 08:00–10:50](https://www.youtube.com/watch?v=_zZxCVBi7-k&t=480s).** A parent/child exchange establishes expectations and personality; the GM then cuts to another character’s home and asks that player to describe the character and room. Observation confidence: high, directly supported by captions. Adaptation: a brief pre-mission spotlight per player, one relationship and one decision, then bring everyone together. The proposed short timing below is ours, not a measured rule from the show.
3. **[Calamity, 14:30–17:15](https://www.youtube.com/watch?v=KlIkkeWmVvA&t=870s).** A perception result leads into specific sensory information, an emotionally familiar companion and a mystery whose language the character cannot understand. Observation confidence: high, directly supported by captions. Adaptation: give the squad something concrete to inspect and a reason to care. Do not prewrite their emotional reaction or the action they must take.

For the highest-viewed comparison, the [official Kraghammer video description](https://www.youtube.com/watch?v=i-p9lWIhcLQ) establishes a missing-person mission, city exploration and trouble coming from the mines. That is description-level evidence, not a transcript review of its full session.

## Original rehearsal: The Signal Beneath Saltglass

**Format:** a proposed 45–60-minute opening for one GM and two players, with an optional extension. This is a small rehearsal design, not a balanced rules supplement. Use the group’s chosen rules, approved character sheets and supported encounter mechanics. All dialogue and new situation details below are original sample material, not quotations or existing campaign canon. The GM can rename or replace them to fit the current campaign.

### Player-facing opening

> Rain taps against the overturned courier cart. Its lantern is still burning, though seawater has reached the flame. Beyond the rocks, a patrol’s lights move along the shore. Someone beneath the cart knocks twice, pauses, then knocks twice again.
>
> Your briefing was simple: find the courier and bring them home. The satchel caught beneath the axle bears your unit’s seal. You were told no other team had been sent.

Stop speaking and invite action. Offer examples only if needed: approach the cart, watch the patrol, investigate the signal, or try another approach. These are prompts, not the only legal actions. Show only the shore, visible lights and accessible terrain; do not reveal unseen patrol identities or the contents of the satchel.

### Give each player a foothold — about two minutes total

Ask each player to choose or invent one connection: they recognize the signaling rhythm, they previously promised the courier help, or this is their first mission with the other operator. A player may decline all three and invent a different reason. Ask what their teammate notices as they arrive. These answers establish player-approved details; AI must not silently invent a character’s past.

### GM preparation

Use three locations: the cart, a sheltered route through the rocks and a shore checkpoint. Prepare one injured courier, a patrol contact willing to speak and a local witness who wants safe passage. Give each NPC one immediate want and one piece of useful information. Use approved names/stat blocks if this enters a real game.

The courier wants extraction. The patrol contact wants to know why a unit-marked cart is on the shore. The witness knows a route above the tide line. The patrol need not be hostile. The seal’s meaning is an open mystery; do not decide that a player character secretly betrayed the squad.

For a rehearsal, choose a simple explanation in advance: someone duplicated a supply mark, and the satchel contains a partial transfer record. This is a proposed GM fact only. Players learn it through inspecting the mark, questioning a knowledgeable person, or examining the record. Do not place all essential progress behind one die roll.

### Scene beats, with flexible timing

| Approximate time | Situation | Meaningful player decisions | Information to record |
|---|---|---|---|
| 0–5 min | Arrive and introduce the operators | Approach, observe, signal, or choose another plan | Player-approved connections and first intent |
| 5–15 min | Reach the courier | Aid, free the cart, secure the satchel, ask questions | Actual condition, gear and discovered facts |
| 15–25 min | Patrol makes contact or moves closer | Negotiate, conceal, distract, withdraw, or fight if the situation warrants | What the patrol actually knows and any costs |
| 25–40 min | Choose an extraction route | Sheltered detour, open checkpoint, split tasks, or an improvised route | Chosen route and consequences supported by play |
| 40–50 min | Resolve the rescue and review the evidence | Who receives help, who retains the satchel, who is told what | Mission outcome and unresolved leads |
| 50–60 min | Debrief and choose the next lead | Follow the transfer record, investigate the copied seal, or pursue the players’ own lead | Confirmed facts, beliefs, open questions, pending choices |

These times guide facilitation; they are not deadlines that override play. Allow successful ideas to shorten a scene. Do not require a fight to demonstrate the tactical system.

### Pressure and consequences

Use visible fiction to signal pressure: water reaches the wheel hub; the patrol’s lights stop and turn. If the GM wants a scene clock, explain what it represents and advance it only for established elapsed time or declared consequences. It must not be silently driven by real-world discussion time, a player’s access needs, or an AI’s preferred pacing.

When a risky attempt fails, apply the chosen game’s actual result and an established consequence: a lost position, a visible trace, a delay, or additional negotiation. A clue can remain available through another plausible route. Success changes the situation too: a rescued witness may volunteer the safe path. None of those outcomes is predetermined.

### Presentation treatment using the existing direction

- Begin with one approved Saltglass image or a simple area map, a short objective and player portraits. Reveal the detailed tactical map when spatial decisions need it.
- Keep prose short enough to leave room for player speech. Put optional lore behind an explicit request.
- Use original/approved ambience quietly under speech. Shift mood only when visible events justify it. Preserve a GM override and silence during breaks. This is a presentation recommendation; no audio configuration was changed.
- Keep GM-only explanations off shared imagery, recaps and player handouts. A generated illustration cannot establish the satchel’s contents, the patrol’s intent or a successful rescue.
- End with a recap that distinguishes established facts from suspicions. Let players correct it before it becomes the next session’s starting point.

### What would count as a successful rehearsal

These are proposed checks; none was run for this report.

1. Each player can state the immediate objective after the opening and gets a meaningful decision in the first five minutes.
2. Players can attempt different approaches without being forced back onto a scripted solution.
3. Both interfaces show the same recorded outcome; information intended only for the GM remains private.
4. Save/resume preserves the chosen route, actual consequences and unresolved decisions.
5. The group can continue if AI, image generation or music is unavailable.
6. Each participant can identify one moment of agency and one confusing moment. Use that feedback before expanding the campaign.

The project’s full live acceptance requirements remain broader, including authorized voice use, consent changes, correction handling and controlled restart. A good rehearsal alone does not satisfy those release requirements.

## Verification and limitations

Verified for this work: local canonical project directory exists; current acceptance document and repository instructions read through Gortex; project memory searched in the required wing; active claims inspected; live public video metadata retrieved; nonempty English captions obtained and selected excerpts inspected. No fresh gameplay, browser/Discord integration, audio or multiplayer acceptance test was performed. No gameplay source, live store or deployment was modified.

Citadel note: its route preflight first reported stale derived state. Reconciliation refreshed only `.citadel/effective-config.json`; it then exposed invalid existing configuration (`trust.sessions_completed`, CONFIG_FAIL_CLOSED). The research route was not invoked and the harness configuration was not repaired. The review and research proceeded directly. The new report’s pre-edit graph impact returned file_not_indexed because the file did not yet exist; that is not evidence of complete graph coverage.

Next content decision: try the three excerpts, then rehearse this opening or adapt the same techniques to the campaign currently selected in the game. The sample title and events remain proposals until adopted and played.
