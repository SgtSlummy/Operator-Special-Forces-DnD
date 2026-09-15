const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Decide how much result text and which image size a viewer should receive. */
export function adjudicateDetail({ actor = {}, roll = null, buffs = [], storyInitiative = 'ordinary', requestedFocus = null } = {}) {
  const ability = Number.isFinite(actor.ability) ? actor.ability : 10;
  const modifier = Math.floor((ability - 10) / 2);
  const bonus = Array.isArray(buffs) ? buffs.length : 0;
  const total = Number.isFinite(roll?.total) ? roll.total : null;
  const critical = roll?.critical === true || total === 20;
  const failure = total !== null && total <= 9;
  const urgent = ['urgent', 'critical', 'deadline'].includes(storyInitiative);
  const inspection = typeof requestedFocus === 'string' && requestedFocus.trim().length > 0;
  const rich = inspection && (critical || (!failure && (modifier + bonus >= 3 || urgent)));
  const level = rich ? 'rich' : inspection || total !== null ? 'standard' : 'brief';
  return Object.freeze({
    level,
    imageSize: rich ? 'large' : 'medium',
    textBudget: level === 'rich' ? 900 : level === 'standard' ? 420 : 180,
    flavorBudget: level === 'rich' ? 420 : level === 'standard' ? 160 : 60,
    reason: rich ? 'specific inspection supported by the resolved roll, actor modifiers, buffs, or story urgency' : inspection ? 'specific inspection receives a standard result until the roll supports more detail' : 'normal scene state uses concise player-facing detail',
    inputs: { modifier: clamp(modifier, -5, 10), buffCount: bonus, rollTotal: total, urgent, inspection },
  });
}
