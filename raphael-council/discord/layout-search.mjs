/**
 * Deterministic layout search for the Discord D&D play surface.
 *
 * This is intentionally a small, reproducible design evaluator rather than a
 * message spammer. It explores 300 candidates and returns the best payload
 * hierarchy for a narrow Discord/mobile reading surface.
 */
const PHI = (1 + Math.sqrt(5)) / 2;
const GOLDEN_SPLITS = [1 / PHI ** 2, 1 / PHI, 1 - 1 / PHI ** 2];
const ACCENTS = ['ember', 'brine', 'lantern', 'copper', 'moon'];
const ART_POSITIONS = ['top', 'left', 'right'];
const STATUS_ORDERS = [
  ['day', 'deadline', 'heat', 'supplies', 'support'],
  ['day', 'heat', 'supplies', 'support', 'deadline'],
  ['deadline', 'day', 'heat', 'support', 'supplies'],
  ['day', 'location', 'deadline', 'heat', 'supplies'],
];

const seeded = seed => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
};

const pick = (random, values) => values[Math.floor(random() * values.length)];
const clamp = value => Math.max(0, Math.min(1, value));

function candidate(random, index) {
  const artRatio = pick(random, GOLDEN_SPLITS);
  const order = pick(random, STATUS_ORDERS);
  return {
    iteration: index,
    artRatio,
    artPosition: pick(random, ART_POSITIONS),
    accent: pick(random, ACCENTS),
    statusOrder: order,
    statusRows: 1 + Math.floor(random() * 3),
    actionRows: 1 + Math.floor(random() * 3),
    actionLabels: pick(random, ['short', 'verb-first', 'role-first']),
    mapFirst: random() > 0.42,
    divider: random() > 0.35,
    footer: random() > 0.46,
  };
}

function score(layout) {
  const golden = 1 - Math.min(...GOLDEN_SPLITS.map(split => Math.abs(layout.artRatio - split))) / 0.5;
  const statusFit = layout.statusRows === 2 ? 1 : layout.statusRows === 1 ? 0.83 : 0.57;
  const actionFit = layout.actionRows === 2 ? 1 : layout.actionRows === 1 ? 0.82 : 0.55;
  const mobile = 1 - (layout.actionRows === 3 ? 0.28 : 0) - (layout.statusRows === 3 ? 0.18 : 0);
  const turnClarity = layout.mapFirst && layout.actionLabels === 'verb-first' ? 1 : layout.mapFirst ? 0.93 : 0.82;
  const hierarchy = (layout.divider ? 0.08 : 0) + (layout.footer ? 0.03 : 0) + (layout.artPosition === 'top' ? 0.06 : 0);
  const score = 100 * clamp(
    golden * 0.22 + statusFit * 0.17 + actionFit * 0.19 + mobile * 0.18 + turnClarity * 0.16 + hierarchy * 0.08,
  );
  return { ...layout, score: Number(score.toFixed(3)), reasons: { golden, statusFit, actionFit, mobile, turnClarity } };
}

export function searchLayouts(iterations = 300, seed = 0xD20D) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('iterations must be positive');
  const random = seeded(seed);
  return Array.from({ length: iterations }, (_, index) => score(candidate(random, index + 1)))
    .sort((a, b) => b.score - a.score || a.iteration - b.iteration);
}

export function winningLayout(iterations = 300, seed = 0xD20D) {
  const ranked = searchLayouts(iterations, seed);
  return { iterations, seed, winner: ranked[0], finalists: ranked.slice(0, 5) };
}

if (process.argv[1]?.toLowerCase().endsWith('layout-search.mjs')) {
  console.log(JSON.stringify(winningLayout(Number(process.argv[2] ?? 300)), null, 2));
}
