import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';

const shore = 'saltglass-party-shore', abbey = 'abbey-archive';
const names = { [shore]: 'Saltglass Shore', [abbey]: 'Drowned Abbey Archive' };

// Discovery comes from committed receipts, never future scene art or narration.
export function areaMapState(step, history = []) {
  if (!Number.isSafeInteger(step.gameRevision) || step.gameRevision < 0) throw new Error('Area map needs a valid game revision');
  if (!names[step.map?.id]) return null;
  const receipts = [...history, step].filter(event => Number.isSafeInteger(event.gameRevision)
    && event.gameRevision <= step.gameRevision);
  const abbeyKnown = step.map.id === abbey || receipts.some(event =>
    event.action?.type === 'help_the_courier' && event.notes?.consequence === 'courier rescued; abbey lead opened');
  return {
    type: 'known-locations', title: 'Saltglass Shore', gameRevision: step.gameRevision,
    currentLocation: names[step.map.id], currentLocationId: step.map.id,
    knownLocations: [shore, ...(abbeyKnown ? [abbey] : [])],
    description: 'Known locations, not to scale. The party is at ' + names[step.map.id] + '. '
      + (abbeyKnown ? 'Drowned Abbey Archive is a discovered lead. No route or distance is confirmed.' : 'The surrounding area is unexplored.'),
  };
}

function text(ctx, value, x, y, size = 24, color = '#eee8db', weight = 500) {
  ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`;
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(value, x, y);
}

function placeLabel(ctx, x, y, title, subtitle, current) {
  ctx.fillStyle = 'rgba(16,27,32,.96)';
  ctx.beginPath(); ctx.roundRect(x, y, 360, 82, 8); ctx.fill();
  ctx.strokeStyle = current ? '#c9a775' : '#83b7b1'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = current ? '#c9a775' : '#83b7b1';
  ctx.beginPath(); ctx.arc(x + 22, y + 27, 5, 0, Math.PI * 2); ctx.fill();
  text(ctx, title, x + 38, y + 27, 25, '#eee8db', 600);
  text(ctx, subtitle, x + 38, y + 59, 21, '#c0ceca');
}

export async function renderAreaMap(step, outputPath, { backgroundPath, history = [] } = {}) {
  const state = areaMapState(step, history);
  if (!state) throw new Error('No authored area overview for this map');
  if (!backgroundPath) throw new Error('Approved area artwork is required');
  const background = await loadImage(backgroundPath);
  const canvas = createCanvas(1280, 872), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101b20'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, 1280, 800);
  if (!state.knownLocations.includes(abbey)) {
    // Opaque mask covers the entire future landmark, including its shape.
    ctx.fillStyle = '#26373b'; ctx.fillRect(0, 0, 1280, 410);
    const fog = ctx.createLinearGradient(0, 410, 0, 525);
    fog.addColorStop(0, '#26373b'); fog.addColorStop(1, 'rgba(38,55,59,0)');
    ctx.fillStyle = fog; ctx.fillRect(0, 410, 1280, 115);
    text(ctx, 'Unexplored', 86, 220, 30, '#c0ceca');
  } else {
    placeLabel(ctx, 470, 155, names[abbey], state.currentLocationId === abbey ? 'Party location' : 'Discovered lead', state.currentLocationId === abbey);
  }
  placeLabel(ctx, 80, 515, names[shore], state.currentLocationId === shore ? 'Party location' : 'Known location', state.currentLocationId === shore);
  text(ctx, state.title, 32, 836, 26, '#eee8db', 600);
  text(ctx, 'Known locations · not to scale', 760, 836, 23, '#c0ceca');
  await writeFile(outputPath, canvas.toBuffer('image/png'));
  return state;
}
