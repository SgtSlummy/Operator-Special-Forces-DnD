// Shared logical coordinates for octagonal cells with non-playable square fillers.
export const DIRECTIONS = Object.freeze([[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(Object.freeze));
export const cellKey = (x, y) => `${x},${y}`;
export const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export function coordinate(x, y) {
  if (!Number.isInteger(x) || x < 0 || !Number.isInteger(y) || y < 0) throw new Error('Invalid grid coordinate.');
  let col = '', n = x + 1;
  while (n) { n--; col = String.fromCharCode(65 + n % 26) + col; n = Math.floor(n / 26); }
  return `${col}${y + 1}`;
}
export function parseCoordinate(value) {
  const match = typeof value === 'string' && /^([A-Z]{1,3})([1-9][0-9]{0,3})$/i.exec(value.trim());
  if (!match) throw new Error('Use a grid coordinate such as A1.');
  let x = 0;
  for (const char of match[1].toUpperCase()) x = x * 26 + char.charCodeAt(0) - 64;
  return { x: x - 1, y: Number(match[2]) - 1 };
}
export function inBounds(map, point, size = 1) {
  return Number.isInteger(point?.x) && Number.isInteger(point?.y) && point.x >= 0 && point.y >= 0 && point.x + size <= map.width && point.y + size <= map.height;
}
export function footprint(point, size = 1) {
  if (!Number.isInteger(size) || size < 1 || size > 4) throw new Error('Unsupported token footprint.');
  const cells = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cells.push({ x: point.x + dx, y: point.y + dy });
  return cells;
}
export function canOccupy(map, point, { size = 1, occupied = [] } = {}) {
  if (!inBounds(map, point, size)) return false;
  const blocked = new Set([...(map.blocked ?? []), ...occupied].map(p => cellKey(p.x, p.y)));
  return footprint(point, size).every(p => !blocked.has(cellKey(p.x, p.y)));
}
export function stepCost(map, from, to, options = {}) {
  if (distance(from, to) !== 1 || !canOccupy(map, to, options)) return Infinity;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx && dy && (!canOccupy(map, { x: from.x + dx, y: from.y }, options) || !canOccupy(map, { x: from.x, y: from.y + dy }, options))) return Infinity;
  // Initial explicit house policy: a step is five feet, difficult terrain doubles it.
  const difficult = new Set((map.difficult ?? []).map(p => cellKey(p.x, p.y)));
  return footprint(to, options.size ?? 1).some(p => difficult.has(cellKey(p.x, p.y))) ? 10 : 5;
}
/**
 * @param {object} map
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} target
 * @param {{budget?:number,size?:number,occupied?:Array<{x:number,y:number}>}} options
 */
export function findPath(map, start, target, { budget = Infinity, ...options } = {}) {
  if (!inBounds(map, start, options.size ?? 1) || !inBounds(map, target, options.size ?? 1)) return null;
  if (distance(start, target) === 0) return { path: [], cost: 0 };
  const startKey = cellKey(start.x, start.y), endKey = cellKey(target.x, target.y);
  const costs = new Map([[startKey, 0]]), previous = new Map(), open = [{ ...start, cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
    const current = open.shift(), key = cellKey(current.x, current.y);
    if (current.cost !== costs.get(key)) continue;
    if (key === endKey) {
      const path = [];
      let cursor = key;
      while (cursor !== startKey) { const [x, y] = cursor.split(',').map(Number); path.unshift({ x, y }); cursor = previous.get(cursor); }
      return { path, cost: current.cost };
    }
    for (const [dx, dy] of DIRECTIONS) {
      const next = { x: current.x + dx, y: current.y + dy }, nextKey = cellKey(next.x, next.y);
      const nextCost = current.cost + stepCost(map, current, next, options);
      if (nextCost <= budget && nextCost < (costs.get(nextKey) ?? Infinity)) { costs.set(nextKey, nextCost); previous.set(nextKey, key); open.push({ ...next, cost: nextCost }); }
    }
  }
  return null;
}
// Conservative supercover LOS: crossing a blocked corner is occluded.
export function lineOfSight(map, from, to) {
  const blocks = new Set((map.blocked ?? []).map(p => cellKey(p.x, p.y)));
  let x = from.x, y = from.y;
  const dx = to.x - x, dy = to.y - y, nx = Math.abs(dx), ny = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
  let ix = 0, iy = 0;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      if (blocks.has(cellKey(x + sx, y)) || blocks.has(cellKey(x, y + sy))) return false;
      x += sx; y += sy; ix++; iy++;
    } else if (decision < 0) { x += sx; ix++; } else { y += sy; iy++; }
    if (x === to.x && y === to.y) return true; // A wall cell itself can be seen.
    if (blocks.has(cellKey(x, y))) return false;
  }
  return true;
}
export function visibleCells(map, viewers) {
  const result = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const p = { x, y };
    if (viewers.some(v => distance(v, p) <= v.vision && lineOfSight(map, v, p))) result.push(p);
  }
  return result;
}
export function octagonPoints(x, y, cellSize) {
  // Regular octagon inscribed in a square; adjacent corners leave square fillers.
  const cut = cellSize / (2 + Math.SQRT2), left = x * cellSize, top = y * cellSize;
  return [[cut, 0], [cellSize - cut, 0], [cellSize, cut], [cellSize, cellSize - cut], [cellSize - cut, cellSize], [cut, cellSize], [0, cellSize - cut], [0, cut]].map(([px, py]) => [left + px, top + py]);
}
