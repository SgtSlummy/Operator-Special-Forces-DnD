import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';

const ink = '#101b20', paper = '#eee8db', bronze = '#c9a775', teal = '#83b7b1';

// Never invent visibility from actor names, or substitute the host's board.
export function mapView(step, viewer = 'admin') {
  const view = viewer === 'admin' ? step : step.viewerSnapshots?.[viewer];
  if (!view) throw new Error('Missing visibility-scoped map snapshot for ' + viewer);
  const { map, actors } = view;
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height)
    || map.width < 1 || map.height < 1 || map.width > 26 || map.height > 32) {
    throw new Error('Map dimensions must be integers within 26 columns and 32 rows');
  }
  if (!Array.isArray(actors)) throw new Error('Map actors are required');
  if (view.gameRevision !== step.gameRevision) throw new Error('Map snapshot revision does not match deck');
  for (const actor of actors) {
    if (!Number.isInteger(actor.x) || !Number.isInteger(actor.y)
      || actor.x < 0 || actor.y < 0 || actor.x >= map.width || actor.y >= map.height) {
      throw new Error('Actor position is outside the board: ' + actor.id);
    }
  }
  return { map, actors };
}

function label(ctx, text, x, y, { color = paper, size = 19, align = 'left', weight = 500 } = {}) {
  ctx.font = weight + ' ' + size + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function portraitKey(actor) {
  return actor.portraitId ?? (actor.id.startsWith('brine-wight') ? 'brine' : actor.id);
}

function drawToken(ctx, actor, portrait, x, y, size, active) {
  const radius = size * .19;
  const defeated = actor.defeated || actor.hp <= 0;
  const accent = ['branna', 'pip', 'kael'].includes(actor.id) ? teal : '#d29996';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowOffsetY = 4;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = active ? bronze : ink;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = defeated ? .55 : 1;
  const side = Math.min(portrait.width, portrait.height);
  ctx.drawImage(portrait, (portrait.width - side) / 2, (portrait.height - side) / 2,
    side, side, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
  ctx.strokeStyle = active ? bronze : accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (defeated) {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(x + radius - 3, y + radius - 3, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = paper; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x + radius - 6, y + radius - 6); ctx.lineTo(x + radius, y + radius);
    ctx.moveTo(x + radius, y + radius - 6); ctx.lineTo(x + radius - 6, y + radius); ctx.stroke();
  } else {
    const hpMax = actor.maxHp ?? actor.hpMax ?? actor.hp;
    const proportion = hpMax > 0 ? Math.min(1, Math.max(0, actor.hp / hpMax)) : 0;
    ctx.fillStyle = ink;
    ctx.fillRect(x - radius * .72, y + radius + 3, radius * 1.44, 3);
    ctx.fillStyle = accent;
    ctx.fillRect(x - radius * .72, y + radius + 3, radius * 1.44 * proportion, 3);
  }
}

function terrainEmblem(ctx, x, y, kind) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(-12, -12, 24, 24, 4); ctx.fill();
  ctx.strokeStyle = kind === 'blocked' ? '#cd9866' : paper;
  ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
  if (kind === 'blocked') {
    // A small stone silhouette represents movement blocking, not an unearned cover bonus.
    ctx.moveTo(-8, 7); ctx.lineTo(-6, -4); ctx.lineTo(0, -8); ctx.lineTo(7, -3); ctx.lineTo(8, 7); ctx.closePath();
    ctx.moveTo(0, -8); ctx.lineTo(2, 1); ctx.lineTo(8, 7);
  } else {
    // Boot sole: extra movement cost on rough ground.
    ctx.moveTo(-5, -8); ctx.lineTo(2, -8); ctx.lineTo(2, 1); ctx.lineTo(8, 4); ctx.lineTo(8, 8); ctx.lineTo(-7, 8); ctx.lineTo(-7, 3); ctx.closePath();
  }
  ctx.stroke(); ctx.restore();
}

// Artwork is registered to the board's full extent, never cropped to a story scene.
export async function renderTacticalMap(step, outputPath, {
  viewer = 'admin', backgroundPath = null, portraits = {}, showTactics = false,
} = {}) {
  const { map, actors } = mapView(step, viewer);
  if (!backgroundPath) throw new Error('No approved top-down artwork for map ' + map.id);
  const background = await loadImage(backgroundPath);
  const tokenImages = new Map();
  for (const actor of actors) {
    const key = portraitKey(actor);
    if (!portraits[key]) throw new Error('Approved portrait missing for ' + actor.id);
    if (!tokenImages.has(key)) tokenImages.set(key, await loadImage(portraits[key]));
  }
  // Keep small encounters luxurious while keeping a 25×25 board legible in Discord embeds.
  const cell = Math.max(64, Math.min(112, Math.floor(1800 / Math.max(map.width, map.height)))), gutter = 32;
  const mapWidth = map.width * cell, mapHeight = map.height * cell;
  const canvas = createCanvas(mapWidth + gutter * 2, mapHeight + gutter * 2 + 68);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, gutter, gutter, mapWidth, mapHeight);
  ctx.save();
  ctx.translate(gutter, gutter);
  ctx.strokeStyle = 'rgba(12,22,25,.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= map.width; x++) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, mapHeight); }
  for (let y = 0; y <= map.height; y++) { ctx.moveTo(0, y * cell); ctx.lineTo(mapWidth, y * cell); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(238,232,219,.18)';
  ctx.lineWidth = .7;
  ctx.stroke();
  for (const p of map.blocked ?? []) terrainEmblem(ctx, p.x * cell + 17, (p.y + 1) * cell - 17, 'blocked');
  for (const p of map.difficult ?? []) terrainEmblem(ctx, p.x * cell + 17, (p.y + 1) * cell - 17, 'difficult');
  if (showTactics) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = bronze;
    for (const p of map.blocked ?? []) ctx.strokeRect(p.x * cell + 12, p.y * cell + 12, cell - 24, cell - 24);
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = paper;
    for (const p of map.difficult ?? []) ctx.strokeRect(p.x * cell + 17, p.y * cell + 17, cell - 34, cell - 34);
    ctx.setLineDash([]);
  }
  const activeId = step.action?.actorId ?? step.initiative?.activeActorId;
  for (const actor of [...actors].sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId))) {
    if (actor.id === activeId) {
      ctx.strokeStyle = bronze; ctx.lineWidth = 2;
      ctx.strokeRect(actor.x * cell + 3, actor.y * cell + 3, cell - 6, cell - 6);
    }
    drawToken(ctx, actor, tokenImages.get(portraitKey(actor)), (actor.x + .76) * cell, (actor.y + .74) * cell, cell, actor.id === activeId);
  }
  ctx.restore();
  for (let x = 0; x < map.width; x++) label(ctx, String.fromCharCode(65 + x), gutter + (x + .5) * cell, 16, { size: 17, align: 'center' });
  for (let y = 0; y < map.height; y++) label(ctx, String(y + 1), 15, gutter + (y + .5) * cell, { size: 17, align: 'center' });
  const footerY = gutter + mapHeight + 29;
  label(ctx, step.mapScene?.title ?? 'Encounter map', gutter, footerY, { size: 22, weight: 600 });
  label(ctx, '1 square = 5 ft', canvas.width - gutter, footerY, { size: 18, color: '#bdc9c6', align: 'right' });
  terrainEmblem(ctx, gutter + 12, footerY + 31, 'blocked');
  label(ctx, 'Blocking stone', gutter + 33, footerY + 31, { size: 17, color: '#bdc9c6' });
  terrainEmblem(ctx, gutter + 228, footerY + 31, 'difficult');
  label(ctx, 'Rough ground', gutter + 249, footerY + 31, { size: 17, color: '#bdc9c6' });
  ctx.strokeStyle = bronze; ctx.lineWidth = 2; ctx.strokeRect(gutter + 418, footerY + 21, 20, 20);
  label(ctx, 'Acting character', gutter + 449, footerY + 31, { size: 17, color: '#bdc9c6' });
  await writeFile(outputPath, canvas.toBuffer('image/png'));
  return outputPath;
}
