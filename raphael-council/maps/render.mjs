import { createCanvas } from '@napi-rs/canvas';
import { octagonPoints, coordinate, cellKey } from './grid.mjs';

export function mapEffectLegend(view) {
  const visible = new Set(view.map.cells.map(p => cellKey(p.x, p.y)));
  return view.effects.map(effect => {
    const seen = new Set();
    const cells = effect.cells.filter(p => {
      const key = cellKey(p.x, p.y);
      if (!visible.has(key) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    return { ...effect, cells };
  }).filter(effect => effect.cells.length).map((effect, index) => ({ ...effect, number: index + 1 }));
}

export function mapEffectCellLabel(numbers, maxWidth, measureText) {
  for (let count = numbers.length; count > 0; count--) {
    const remaining = numbers.length - count;
    const label = `#${numbers.slice(0, count).join(',')}${remaining ? ` +${remaining}` : ''}`;
    if (measureText(label) <= maxWidth) return label;
  }
  // At the minimum cell size, keep a zone ID and mark that more zones overlap.
  return `#${numbers[0]}${numbers.length > 1 ? '+' : ''}`;
}

function fittedActorName(name, width, measureText) {
  let label = name.slice(0, 24);
  if (measureText(label) <= width) return label;
  while (label.length > 1 && measureText(`${label}…`) > width) label = label.slice(0, -1);
  return `${label}…`;
}

// Accept only an already authorized projection, never the game's raw state.
export function renderTacticalMap(view, { cellSize = 64 } = {}) {
  if (!view?.map || !Array.isArray(view.map.cells) || !Array.isArray(view.actors) || !Array.isArray(view.effects)) throw new Error('An authorized map projection is required.');
  if (!Number.isInteger(cellSize) || cellSize < 32 || cellSize > 96 || !Number.isInteger(view.map.width) || view.map.width < 2 || view.map.width > 64 || !Number.isInteger(view.map.height) || view.map.height < 2 || view.map.height > 64) throw new Error('Invalid map dimensions.');
  const legend = mapEffectLegend(view);
  const dimensions = size => {
    const width = Math.max(640, view.map.width * size + 32), columns = width >= 960 ? 3 : 2;
    return { width, columns, height: view.map.height * size + 112 + Math.ceil(legend.length / columns) * 38 };
  };
  while (cellSize > 32 && dimensions(cellSize).width * dimensions(cellSize).height > 16000000) cellSize--;
  const { width, height, columns } = dimensions(cellSize);
  if (width * height > 16000000) throw new Error('Reduce cell size for this map.');
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0a13'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f7f3e8'; ctx.font = 'bold 20px Arial'; ctx.fillText(view.map.title.slice(0, 100), 16, 28, width - 32);
  ctx.fillStyle = '#e7d1b1'; ctx.font = '14px Arial'; ctx.fillText(`Round ${view.round} · Turn ${view.turn} · Revision ${view.revision} · ${view.phase}`, 16, 52, width - 32);
  const visible = new Set(view.map.cells.map(p => cellKey(p.x, p.y))), blocked = new Set(view.map.blocked.map(p => cellKey(p.x, p.y))), difficult = new Set(view.map.difficult.map(p => cellKey(p.x, p.y)));
  ctx.save(); ctx.translate(16, 72);
  for (let y = 0; y < view.map.height; y++) for (let x = 0; x < view.map.width; x++) {
    const key = cellKey(x, y), seen = visible.has(key);
    const points = octagonPoints(x, y, cellSize);
    ctx.beginPath(); points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
    ctx.fillStyle = !seen ? '#111019' : blocked.has(key) ? '#534957' : difficult.has(key) ? '#403927' : '#24212a'; ctx.fill();
    ctx.strokeStyle = seen ? '#776653' : '#24212a'; ctx.lineWidth = 1; ctx.stroke();
    if (!seen) continue;
    if (blocked.has(key)) { ctx.strokeStyle = '#b0a5b5'; ctx.beginPath(); ctx.moveTo(x * cellSize + 20, y * cellSize + 20); ctx.lineTo((x + 1) * cellSize - 20, (y + 1) * cellSize - 20); ctx.stroke(); }
  }
  const cellEffects = new Map();
  for (const effect of legend) for (const p of effect.cells) {
    if (!visible.has(cellKey(p.x, p.y))) continue;
    const cell = cellKey(p.x, p.y), numbers = cellEffects.get(cell) ?? []; numbers.push(effect.number); cellEffects.set(cell, numbers);
    ctx.save(); ctx.beginPath(); octagonPoints(p.x, p.y, cellSize).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#f7903033'; ctx.fillRect(p.x * cellSize, p.y * cellSize, cellSize, cellSize); ctx.strokeStyle = '#ee9b3a'; ctx.lineWidth = 2;
    for (let offset = -cellSize; offset < cellSize * 2; offset += 12) { ctx.beginPath(); ctx.moveTo(p.x * cellSize + offset, p.y * cellSize); ctx.lineTo(p.x * cellSize + offset + cellSize, (p.y + 1) * cellSize); ctx.stroke(); }
    ctx.restore();
  }
  const compact = cellSize < 64, headerHeight = compact ? 20 : 14;
  for (const actor of view.actors) {
    const x = (actor.x + actor.size / 2) * cellSize;
    const y = actor.size === 1 && compact ? actor.y * cellSize + headerHeight + (cellSize - headerHeight) / 2 : (actor.y + actor.size / 2) * cellSize;
    const radius = actor.size === 1 ? Math.min(cellSize * 0.29, (cellSize - headerHeight - (compact ? 4 : 14)) / 2) : cellSize * actor.size * 0.29;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = actor.defeated ? '#57505a' : actor.controlled ? '#5c8da1' : '#945550'; ctx.fill();
    ctx.strokeStyle = actor.id === view.activeActorId ? '#ee9b3a' : '#e7d1b1'; ctx.lineWidth = actor.id === view.activeActorId ? 4 : 1; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    if (compact) {
      const fontSize = Math.max(8, Math.min(12, cellSize / 4));
      ctx.font = `bold ${fontSize}px Arial`;
      const baseline = Math.max(y + fontSize / 3, Math.floor(y / cellSize) * cellSize + headerHeight + fontSize);
      ctx.fillText(fittedActorName(actor.name, cellSize * actor.size - 8, text => ctx.measureText(text).width), x, baseline);
    } else {
      const fontSize = Math.max(12, cellSize / 4);
      ctx.font = `bold ${fontSize}px Arial`;
      const baseline = Math.max(y + 5, Math.floor(y / cellSize) * cellSize + headerHeight + fontSize);
      ctx.fillText(actor.name.slice(0, 2).toUpperCase(), x, baseline);
      ctx.font = '12px Arial';
      ctx.fillText(fittedActorName(actor.name, cellSize * actor.size - 8, text => ctx.measureText(text).width), x, (actor.y + actor.size) * cellSize - 4);
    }
    ctx.textAlign = 'start';
  }
  // Paint reserved headers last so neither stripes nor large tokens can cover labels.
  for (const p of view.map.cells) {
    const x = p.x * cellSize, y = p.y * cellSize, numbers = cellEffects.get(cellKey(p.x, p.y));
    ctx.fillStyle = '#15111a'; ctx.fillRect(x + 2, y + 1, cellSize - 4, headerHeight - 1);
    ctx.fillStyle = '#d0b8a3'; ctx.font = `${compact ? 8 : 10}px Arial`;
    const cellLabel = coordinate(p.x, p.y), coordinateWidth = ctx.measureText(cellLabel).width;
    ctx.fillText(cellLabel, x + 4, y + (compact ? 8 : 10));
    if (!numbers) continue;
    ctx.fillStyle = '#ffe2a8'; ctx.font = `bold ${compact ? 8 : 10}px Arial`;
    const maxWidth = compact ? cellSize - 8 : cellSize - 12 - coordinateWidth;
    const label = mapEffectCellLabel(numbers, maxWidth, text => ctx.measureText(text).width);
    ctx.textAlign = compact ? 'start' : 'end';
    ctx.fillText(label, compact ? x + 4 : x + cellSize - 4, y + (compact ? 18 : 10));
    ctx.textAlign = 'start';
  }
  ctx.restore();
  const legendWidth = (width - 32) / columns, legendTop = view.map.height * cellSize + 92;
  for (const effect of legend) {
    const index = effect.number - 1, x = 16 + (index % columns) * legendWidth, y = legendTop + Math.floor(index / columns) * 38;
    ctx.fillStyle = '#ffe2a8'; ctx.font = 'bold 12px Arial'; ctx.fillText(`#${effect.number} ${effect.name}`, x, y, legendWidth - 16);
    ctx.fillStyle = '#e7d1b1'; ctx.font = '11px Arial';
    const timing = { enter: 'On entry', start_turn: 'At turn start', end_turn: 'At turn end' }[effect.trigger] ?? effect.trigger;
    ctx.fillText(`${timing} · expires before turn ${effect.expiresAtTurn}`, x, y + 15, legendWidth - 16);
  }
  ctx.fillStyle = '#e7d1b1'; ctx.font = '12px Arial'; ctx.fillText('5 feet per octagon · diagonal step = 5 feet · stripes = active effect · # = zone · + = more zones', 16, height - 12, width - 32);
  return canvas.toBuffer('image/png');
}
