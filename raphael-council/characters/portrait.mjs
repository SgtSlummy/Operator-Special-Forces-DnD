const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function field(snapshot, key) {
  const value = snapshot?.fields?.[key]?.value;
  return typeof value === 'string' || Number.isSafeInteger(value) ? value : null;
}

/**
 * Builds a deliberately low-detail portrait brief from approved, structured
 * sheet fields. Free-form notes, backstory, and source text are excluded so
 * sheet contents can never become image instructions.
 */
export function characterPortraitBrief(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1) throw new Error('Invalid approved character snapshot.');
  const identity = [field(snapshot, 'name'), field(snapshot, 'species'), field(snapshot, 'classes'), field(snapshot, 'subclass'), field(snapshot, 'background')]
    .map(value => clean(String(value ?? ''))).filter(Boolean);
  const equipment = clean(String(field(snapshot, 'equipment') ?? ''), 600);
  return Object.freeze({
    style: 'simple tabletop portrait',
    prompt: [
      'A simplified character portrait for a tabletop RPG.',
      identity.length ? `Identity data: ${identity.join(' | ')}.` : 'Identity data is incomplete; keep the design neutral.',
      equipment ? `Visible equipment data: ${equipment}.` : 'Equipment appearance is unspecified; use restrained generic gear.',
      'Use flat shapes, a clear silhouette, limited colors, soft readable lighting, and minimal background detail.',
      'Make the character easy to recognize at small Discord card size.',
      'Do not invent hidden history, relationships, abilities, items, or outcomes from unstructured text.',
      'No words, labels, watermark, interface, gore, or photorealistic detail.',
    ].join(' '),
    negativePrompt: 'text, labels, watermark, UI, photorealism, excessive detail, invented items, invented companions, hidden lore',
  });
}

