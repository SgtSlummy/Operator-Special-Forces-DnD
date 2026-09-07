# Reviewed checks and saving throws

The browser campaign panel supports host-requested D20 checks and saves. Run from raphael-council:

```powershell
node --env-file-if-exists=.env.local game/check-cli.mjs --file reviewed-check.json
```

Example host input (change IDs and revision, then explicitly review):

```json
{
  "campaign": "greyharbor",
  "reviewedBy": "HOST_OWNER",
  "id": "balance-001",
  "reviewed": false,
  "expectedRevision": 1,
  "actorId": "scout",
  "label": "Keep your balance",
  "kind": "check",
  "ability": "dexterity",
  "proficiencyMultiplier": 1,
  "proficiencyReason": "Reviewed relevant skill proficiency",
  "advantage": [],
  "disadvantage": [],
  "adjustments": [],
  "dc": 15,
  "cost": "action"
}
```

Use kind check or save; cost none or action. Saves permit proficiency multipliers zero or one; reviewed expertise permits two for checks. Every adjustment has a source and integer value. Advantage/disadvantage arrays list their reviewed sources. Both present cancels to one D20 regardless of source count. The host supplies applicability, not ability scores or the numeric proficiency bonus. Those numbers come from the approved 2024 character snapshot, whose revision and digest must match the encounter actor. Missing or uncertain stats fail instead of falling back to weapon statistics.

Saved rolls now include attacks, checks and saves in their own 20-result revision pages, independent of the recent-action list. Older/Newer controls retrieve persisted history without rolling again or advancing the scene. GET `/api/game/checks?before=REVISION` returns only the current player's receipts, strictly earlier than the cursor, plus `nextBefore` when more exist. Attack entries show their attack and damage dice, modifiers, critical status and saved result. Current pending checks are filtered by owner and scene revision before applying the request limit.

The player can submit only checkId and requestId. Resolution rechecks owner, host membership, scene revision, actor version, pause and any action cost. The total uses the kept die plus recorded modifiers and compares with the private host DC. Raw dice, kept index, discarded dice, source modifiers, character version, outcome and action receipt persist atomically with the game revision/outbox. Retrying the same request returns the saved result; another request cannot reroll an already resolved check. Other players cannot read the prompt or receipt. The DC is not included in player responses.

The arithmetic follows the official 2024 D20-test, ability-modifier, proficiency and advantage/disadvantage descriptions: https://www.dndbeyond.com/sources/dnd/br-2024/playing-the-game . This is an explicit reviewed subset, not a complete rules adapter. Natural 1/20 do not use the attack critical policy for these ordinary checks/saves. Reroll features, passive checks, death saves, automatic condition modifiers, skill detection, save-triggered damage/effects and Discord check controls remain unimplemented. The host must not use this ordinary save path as a substitute for death-save rules.

A scene change invalidates an unresolved request, requiring a fresh host review. This does not create a reaction window or stop other actors. No campaign clock advances merely because a request is prepared or viewed. Existing campaigns created without matching approved character provenance must be reconciled before this feature can resolve their checks.
