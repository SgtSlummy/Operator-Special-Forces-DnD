# Reviewed saving-throw damage

Status: one-target engine resolution, an authenticated host HTTP authoring handler, and Discord preview/result/history presentation are implemented and tested in local fixtures. The isolated browser form and display components passed actual rendered lifecycle checks against a fixture connection. Mounting them into the shared Play page and verifying the complete player journey there remain unfinished. This is not a complete spell, hazard, condition or multi-target resolver.

## Reviewed request

The existing host-reviewed check request accepts an optional `consequence` only when `kind` is `save` and `cost` is `none`:

```json
{
  "type": "single_target_damage",
  "dice": { "count": 2, "sides": 6, "bonus": 1 },
  "damageType": "fire",
  "onSuccess": "half",
  "mitigation": {
    "reduction": 0,
    "resistance": false,
    "vulnerability": false,
    "immunity": false,
    "reason": "Host reviewed the applicable defenses for this target."
  }
}
```

Every nested key shown is required, and unknown keys are rejected. Dice count is an integer 0–20; sides are 2, 4, 6, 8, 10, 12 or 20; bonus is an integer −100–100. Zero dice permits a reviewed fixed amount. Damage types are acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing or thunder. `onSuccess` is `half` or `none`. Reduction is an integer 0–100; all three defense flags are explicit booleans; the nonempty review reason is at most 300 characters.

The host must review the entire applicable damage/defense calculation for the exact actor snapshot and current scene. Ability and proficiency modifiers continue to come from the pinned approved character. This primitive does not infer defenses from character-sheet prose. It does not model temporary HP, multiple damage types in one packet, conditional defenses, unconsciousness, death saves or massive-damage death. Do not use it to resolve an effect requiring those unsupported rules. The current resolver now hands applied damage to the separately implemented concentration workflow and defers damage completion while its save is pending; concentration uses its own authority, receipt and continuation contract. The host must also keep the check's public label and modifier explanations suitable for its player's audience.

The immutable reviewed body and fingerprint include the consequence. Reusing a check ID with changed damage or mitigation is a conflict. Invalid descriptors fail before insertion or RNG. A completed scene rejects a new damaging save; paused play cannot resolve it. Ordinary checks without a consequence retain their existing request and response shape.

## Resolution and saved result

All existing membership, host authorization, revision, approved profile and living-actor checks run before rolling. The save rolls first; damage dice roll second, including on a successful no-damage save or against immunity, so the receipt records the complete reviewed roll. No new RNG is consumed when replaying a committed request ID.

Calculation order:

1. `rolledTotal = max(0, sum(damageDice) + bonus)`.
2. Failure keeps `rolledTotal`. Success takes zero for `none`, or half rounded down for `half`.
3. Subtract flat reduction, clamping at zero.
4. Resistance halves, rounding down; vulnerability then doubles; immunity produces zero.
5. Subtract the resulting damage from HP, clamping HP at zero.

The result retains the existing check fields and adds:

```json
{
  "consequence": {
    "type": "single_target_damage",
    "damageType": "fire",
    "dice": [3, 4],
    "dieSides": 6,
    "bonus": 1,
    "rolledTotal": 8,
    "afterSave": 4,
    "mitigation": {
      "reduction": 0,
      "resistance": false,
      "vulnerability": false,
      "immunity": false
    },
    "appliedDamage": 4,
    "hpBefore": 20,
    "hpAfter": 16
  },
  "rulesVersion": "raph-reviewed-d20-damage-v1"
}
```

`appliedDamage` is damage after mitigation, before the zero-HP clamp. The actual HP decrease is `hpBefore - hpAfter`. Private review reasons and DC are absent. Pending-check projections expose only `{type, damageType, onSuccess}` for the consequence, not the private damage formula or mitigation review. Results remain subject to existing owner-scoped receipt/history authorization; do not broadcast the private check body.

The same SQLite transaction changes HP, records `check_resolved` with the complete result, records `save_damage_applied` with `{checkId, actorId, consequence}`, updates state, saves the immutable receipt and marks the check resolved. Both event snapshots already contain the new HP. Failure in any write rolls back HP, events, snapshots, receipt and resolution together. A failed uncommitted attempt is not a saved roll; retry may roll again.

`receipt.revision` is the final committed revision. It may include subsequent turn/completion events; it is not necessarily the `check_resolved` event revision. Render or fetch the audience-filtered map from that revision. Clients must tolerate the two same-HP snapshots and not animate the damage twice. A reconnect or duplicate request displays the saved dice/result and does not reapply damage or spend resources.

## Defeat and encounter handling

A save consequence that reduces HP to zero checks combat completion using the existing `encounter_completed` record path. If combat continues and that actor was active, the engine advances past it using the existing end-turn path. Defeating an inactive actor does not spend the active actor's turn. Incoming start-turn hazards can then cause further skips. This is limited defeated-token handling, not full player-character death rules. Narrative mission completion remains governed by the existing world/adjudication logic; this primitive adds no direct mission write.

## Consumer contract and verification

`GET /api/game/checks/request` is host-only and returns `{options:{gameRevision,phase,canRequest,actors:[{id,name}]}}`. It rechecks host membership inside a transaction and includes only living owned actors whose owner is still a campaign member and whose exact approved 2024 character snapshot pin still matches. Removing a player leaves its token ineligible even when its token and approved sheet remain saved. New requests for that removed owner fail with `TARGET` (HTTP 422); resolution requires current membership (HTTP 403). It returns no owner IDs, sheets or review notes. This is the form's source of host visibility and eligible player choices: the general map projection has no role field and its `controlled` actors may be NPCs. The read never requests a check or rolls dice. `canRequest` is false during a pending reaction or concentration save, matching the authoritative mutation lock.

`POST /api/game/checks/request` accepts the reviewed host input and returns `{check}`. It uses the existing authenticated game session, rejects non-host authors before loading character data, enforces same-origin JSON requests and the existing 8,192-byte body limit, and rejects identity, profile, rolled-value and resource overrides. Unknown query fields are rejected. `PROFILE`, `STALE` and conflicting request IDs produce review errors with HTTP 409. The approved character store is supplied by the Next route's canonical service composition.

Existing player checks and resolution handlers pass through the new public summary and saved consequence. The player submits only `checkId` and `requestId`; neither damage nor modifiers can be replaced. The focused HTTP fixture verifies authoring without RNG, own-player resolution, the real PNG rendered with updated HP at the final receipt revision, stale-map refusal, saved replay/history across restart and revoked-session denial. This exercises handlers with fixture authentication and a real GameStore; it does not certify a deployed login flow.

Discord repeats the public consequence warning on every preview page. Immediate saved results and both saved-history entry points use a shared explicit field renderer for the persisted damage and HP values. Focused adapter tests cover pagination, uncertainty/retry without new dice, private-note omission and bound owner/channel controls. These are local transport fixtures; no live Discord messages were sent.

Browser exports in `app/play/check-consequences.tsx` are `PendingDamageNotice`, `SavedDamageDetails`, and `ReviewedSaveRequestForm`. The form requires server-derived host authority, the game revision (not the separate world revision), current eligible player-character options and an `onRefresh` callback that rejects failed refreshes. `CheckRequestPanel` in `app/play/check-request-panel.tsx` wraps the form using the authenticated options read. Its props are `campaign`, `gameRevision`, a rejecting `onRefreshGame` callback and optional `onRequested`. It resets drafts on campaign change, hides on session denial and prevents a new review when the displayed game and options revisions differ. It preserves the form instance during option refresh, and an explicit refresh propagates failures rather than certifying a failed refresh. The real components have now been exercised in an isolated browser: exact-ID/body retry after a lost response, confirmed stale rejection, failed refresh and recovery, mismatched revisions, pending concentration, session denial, campaign reset and saved-result display. The fixture and exact observations are recorded in [browser lifecycle evidence](../research/CHECK_REVIEW_BROWSER_EVIDENCE.md). This proves those component interactions with simulated responses; it does not certify the parent Play mount, actual map pixels or deployed authentication.

Executed checks at this stage: 18 dedicated engine cases; 12 focused HTTP/authoring-options cases plus 30 existing HTTP/check cases; 4 new Discord cases plus 10 existing checks/history cases; 9 pure browser-helper cases. After the removed-member eligibility fix, the combined focused HTTP, damage engine, ordinary checks, pause and Discord damage run passed 55 cases. The earlier combined engine/checks/effects/reactions/Discord regression run passed 97 cases before consumer changes. Targeted lint passed after the membership fix; TypeScript passed before that server-only fix. After adding the concentration lock regression, the 12 focused HTTP cases, eight checked-concentration engine cases and nine concentration HTTP cases passed together (29/29), with targeted lint passing. The lock regression uses an internal truthy pending record only; it does not certify the complete public concentration lifecycle. A separate `checked-concentration-http.integration.test.mjs` case passed with persistent SQLite and actual HTTP handlers/PNG rendering: damage-to-concentration handoff, private ownership, restart/replay without additional RNG, exact bound effect removal and the current map revision. Targeted lint and TypeScript also passed after the isolated browser fixture changes. These counts describe separate runs and overlapping coverage.

## Remaining integration work

- Mount browser pending/result/history displays and the reviewed host form under coordinated Play ownership. Source host authority and eligible actor options from authenticated server state; never infer them from an unfiltered NPC/actor list.
- Repeat the verified isolated review/refresh/retry lifecycle through the mounted Play journey, including final-revision map refresh and saved history. Keep the request body/ID unchanged during an uncertain retry, require a new review after a confirmed stale rejection, and never apply HP again in the client.
- Implement multi-target effects as one reviewed intent with one shared damage roll and per-target saves/mitigation. Do not simulate one simultaneous area effect by creating independent single-target damage requests.
- Add actor conditions and effect lifecycle rules separately. A successful individual save never deletes a shared area effect. Persistent area overlays continue to follow the existing effect engine.
- Complete defenses, temporary HP and zero-HP rules, and verify the concentration handoff through mounted clients, before describing this as general D&D spell automation.

The supported arithmetic follows the saving-throw damage, resistance, vulnerability and immunity sections in the official [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) and [2024 Basic Rules: Playing the Game](https://www.dndbeyond.com/sources/dnd/br-2024/playing-the-game). The SRD requires one shared damage roll when an effect damages multiple targets simultaneously. This narrow primitive deliberately does not claim that capability.
