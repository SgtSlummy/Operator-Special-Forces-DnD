// Use only information already delivered in this viewer's authorized projection.
export function journalEntries(view) {
  return (view.journal ?? []).map(entry => {
    const match = /^Discovered:\s*(Location|Route):([^\r\n]+)$/i.exec(entry);
    if (!match || !match[2].trim()) return entry;
    const kind = match[1].toLowerCase(), identifier = match[2].trim();
    const name = kind === 'location' && identifier === view.sceneId && view.title
      ? view.title
      : identifier.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
    return `Discovered ${kind}: ${name}`;
  });
}

export function choiceGuidance(view) {
  // Older presentation projections expose player pause state in their summary.
  const paused = view.dmStatus?.decisionOpen === false ||
    view.summary?.startsWith('The DM is preparing the scene. Decisions are paused.');
  if (paused) return view.dmStatus
    ? 'Player decisions are paused. Use Open to inspect Map, Character, Inventory or Journal. When ready, return to Map and select Open decisions to review it before confirming.'
    : 'The DM has paused decisions. Use Open to inspect Map, Character, Inventory or Journal while you wait. Your action choices will update when the DM opens decisions.';
  return 'Use Open → Map to choose an action and read its cost and required details. Nothing is submitted until you press Confirm.';
}

export const recoveryGuidance = 'If a response is lost, use Recover original action in the Check your last action panel above. This checks the saved receipt without repeating the action. If recovery still fails, keep this table open and ask the DM for help before trying another action. Refresh reloads the view; it does not recover a receipt.';
