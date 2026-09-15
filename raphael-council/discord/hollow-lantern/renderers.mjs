import { createCanvas, loadImage } from '@napi-rs/canvas';
import { isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';

const ink = '#11171c', gold = '#d7b54a', paper = '#eee4cd';
const terrain = { floor: '#6b6251', wall: '#343b42', water: '#294958', grass: '#455b40', sand: '#b49b68', sea: '#294958', difficult: '#8e7550', road: '#957a51', door: '#a38350' };
const label = (ctx, value, x, y, size = 16, color = paper) => { ctx.fillStyle = color; ctx.font = `${size}px sans-serif`; ctx.fillText(String(value).slice(0, 80), x, y); };
async function approvedImage(source) {
  if (Buffer.isBuffer(source)) return loadImage(source);
  if (typeof source !== 'string' || !isAbsolute(source) || /^(https?:|data:|file:)/i.test(source) || source.startsWith('\\\\') || source.startsWith('//')) throw new Error('Artwork must be approved local bytes or an absolute local path.');
  return loadImage(await readFile(source));
}
function cropPortrait(ctx, image, x, y, size) {
  const side = Math.min(image.width, image.height) * 0.62, sx = (image.width - side) / 2;
  ctx.drawImage(image, sx, image.height * .03, side, side, x, y, size, size);
}
function roundPortrait(ctx, image, x, y, size) {
  ctx.save(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  cropPortrait(ctx, image, x, y, size); ctx.restore();
}
/** Receives only an already scoped projection. Unknown cells are never sampled from source art. */
export async function renderSceneIllustration(source) {
  const image = await approvedImage(source);
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1 || image.width > 8192 || image.height > 8192 || image.width * image.height > 16777216) throw new Error('Scene artwork dimensions are not supported.');
  const scale = Math.min(1, 1536 / image.width, 1536 / image.height);
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}

export async function renderTacticalMap(map, { background, terrainTextures = {}, terrainTexturesByScene = {}, portraits = {}, cellSize = 32, title = 'Your view', detail = false } = {}) {
  const fullWidth = map.width ?? 25, fullHeight = map.height ?? 25;
  let width = fullWidth, height = fullHeight;
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 100) || !Number.isInteger(cellSize) || cellSize < 16 || cellSize > 64) throw new Error('Invalid map dimensions');
  const own = map.viewerCharacterId ? (map.tokens??[]).find(t=>t.characterId===map.viewerCharacterId&&(map.cells??[]).some(c=>c.x===t.x&&c.y===t.y&&c.visibility==='visible')) : undefined;
  const focused = detail === true && own && Number.isInteger(own.x) && Number.isInteger(own.y) && own.x >= 0 && own.y >= 0 && own.x < fullWidth && own.y < fullHeight;
  if (focused) { width = Math.min(9, fullWidth); height = Math.min(9, fullHeight); cellSize = 64; }
  const startX = focused ? Math.max(0, Math.min(fullWidth - width, own.x - Math.floor(width / 2))) : 0;
  const startY = focused ? Math.max(0, Math.min(fullHeight - height, own.y - Math.floor(height / 2))) : 0;
  const inFrame = token => token.x >= startX && token.x < startX + width && token.y >= startY && token.y < startY + height;
  const outdoor=map.id==='coastal-road';
  const palette={...terrain,...(outdoor?{floor:'#887551',wall:'#465460'}:{})};
  const ownColor='#82eee3';
  const margin = 40, header = own ? 110 : 70, rules=map.terrainRulesVersion===1, terrainFooter=rules?48:0;
  const cells = new Map((map.cells ?? []).map(c => [`${c.x},${c.y}`, c]));
  const drawableTokens=(map.tokens??[]).filter(token=>{
    const cell=cells.get(`${token.x},${token.y}`);
    return inFrame(token)&&cell?.visibility==='visible'&&(cell.creaturesVisible!==false||token===own);
  });
  const canvasWidth=Math.max(440,width*cellSize+margin*2);
  const slots=Math.max(1,Math.min(5,Math.floor((canvasWidth-margin*2)/150)));
  const legendRows=Math.max(1,Math.ceil(drawableTokens.length/slots)),legendRowHeight=64;
  const canvas = createCanvas(canvasWidth, height * cellSize + header + 142 + terrainFooter + (legendRows-1)*legendRowHeight);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = ink; ctx.fillRect(0, 0, canvas.width, canvas.height);
  label(ctx, title, margin, 28, 22); label(ctx, `${focused ? "NEARBY: " : ""}${width} × ${height} · ${map.scaleFeet ?? 5} feet per square`, margin, 50, 13, gold);
  if(own){
    label(ctx, `YOU · ${own.displayName??'Your character'} · Column ${own.x+1}, row ${own.y+1}`,margin,74,17,ownColor);
    label(ctx,'Cyan outline = YOU · Gold = companions · Red = foes',margin,94,12,paper);
  }
  const art = background ? await approvedImage(background) : null;
  const sceneTextures = Object.prototype.hasOwnProperty.call(terrainTexturesByScene, map.id) ? terrainTexturesByScene[map.id] ?? {} : {};
  const materialTextures = { ...terrainTextures, ...sceneTextures };
  const textures = new Map();
  for (const key of new Set([...cells.values()].filter(c=>inFrame(c)&&['visible','remembered'].includes(c.visibility)).map(c=>c.terrain))) {
    if (materialTextures[key]&&!(outdoor&&key==='floor'&&!Object.prototype.hasOwnProperty.call(sceneTextures,key))) textures.set(key, await approvedImage(materialTextures[key]));
  }
  for (let y = startY; y < startY + height; y++) for (let x = startX; x < startX + width; x++) {
    const cell = cells.get(`${x},${y}`), px = margin + (x - startX) * cellSize, py = header + (y - startY) * cellSize;
    const known = cell?.visibility === 'visible' || cell?.visibility === 'remembered';
    ctx.fillStyle = known ? palette[cell.terrain] ?? palette.floor : '#10151b'; ctx.fillRect(px, py, cellSize, cellSize);
    if (known && art && cell.terrain !== 'wall') ctx.drawImage(art, x * art.width / fullWidth, y * art.height / fullHeight, art.width / fullWidth, art.height / fullHeight, px, py, cellSize, cellSize);
    const texture = known && textures.get(cell.terrain);
    if (texture) {
      const sample = Math.min(64, texture.width, texture.height);
      ctx.globalAlpha = .24;
      ctx.drawImage(texture, (x * sample) % (Math.floor(texture.width/sample)*sample), (y * sample) % (Math.floor(texture.height/sample)*sample), sample, sample, px, py, cellSize, cellSize);
      ctx.globalAlpha = 1;
    }
    if(known&&['grass','road','sand','water','sea'].includes(cell.terrain)||known&&outdoor&&cell.terrain==='floor'){
      ctx.save();ctx.beginPath();ctx.rect(px+2,py+2,cellSize-4,cellSize-4);ctx.clip();
      ctx.strokeStyle=['water','sea'].includes(cell.terrain)?'#7badbd88':cell.terrain==='grass'?'#9cb07788':'#d0b88466';ctx.lineWidth=1;
      for(let mark=0;mark<3;mark++){const mx=px+5+((x*7+y*3+mark*9)%(cellSize-10)),my=py+6+((y*7+x*3+mark*7)%(cellSize-12));ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(mx+(cell.terrain==='grass'?2:5),my+(cell.terrain==='grass'?-4:0));ctx.stroke();}ctx.restore();
    }
    if (known && cell.terrain === 'wall') {ctx.strokeStyle='#53616b';ctx.lineWidth=2;ctx.strokeRect(px+3,py+3,cellSize-6,cellSize-6);}
    if (known && cell.terrain === 'difficult') {
      ctx.save();ctx.beginPath();ctx.rect(px+2,py+2,cellSize-4,cellSize-4);ctx.clip();
      ctx.strokeStyle='#e0c57688';ctx.lineWidth=Math.max(1,cellSize/32);
      for(let offset=-cellSize;offset<cellSize;offset+=cellSize/4){ctx.beginPath();ctx.moveTo(px+offset,py+cellSize);ctx.lineTo(px+offset+cellSize,py);ctx.stroke();}
      // Small planar rubble marks describe the existing movement cost, not new obstacles.
      for(let i=0;i<3;i++){
        const rx=px+cellSize*(.22+.25*i),ry=py+cellSize*(i%2?.32:.64),r=cellSize*.105;
        ctx.fillStyle='#493f32';ctx.beginPath();ctx.moveTo(rx-r,ry);ctx.lineTo(rx-r*.5,ry-r);ctx.lineTo(rx+r*.7,ry-r*.6);ctx.lineTo(rx+r,ry+r*.45);ctx.lineTo(rx-r*.4,ry+r*.65);ctx.closePath();ctx.fill();
        ctx.strokeStyle='#bea57b';ctx.lineWidth=Math.max(1,cellSize/48);ctx.beginPath();ctx.moveTo(rx-r,ry);ctx.lineTo(rx-r*.5,ry-r);ctx.lineTo(rx+r*.7,ry-r*.6);ctx.stroke();
      }ctx.restore();
    }
    if(known&&rules&&['half','three-quarters','total'].includes(cell.cover)){
      ctx.save();ctx.beginPath();ctx.rect(px+2,py+2,cellSize-4,cellSize-4);ctx.clip();
      const inset=cellSize*.11,left=px+inset,top=py+inset,side=cellSize-inset*2;
      const face=cell.cover==='total'?'#37454b':cell.cover==='half'?'#567b81':'#756181';
      ctx.fillStyle='#131d24';ctx.fillRect(left+cellSize*.05,top+cellSize*.07,side,side);
      ctx.fillStyle=face;ctx.fillRect(left,top,side,side-cellSize*.06);
      ctx.strokeStyle='#b7c7c4';ctx.lineWidth=Math.max(1,cellSize*.035);ctx.beginPath();ctx.moveTo(left,top+side-cellSize*.06);ctx.lineTo(left,top);ctx.lineTo(left+side,top);ctx.stroke();
      ctx.strokeStyle='#233239';ctx.beginPath();ctx.moveTo(left+side,top);ctx.lineTo(left+side,top+side-cellSize*.06);ctx.lineTo(left,top+side-cellSize*.06);ctx.stroke();
      // Masonry seams remain inside the already solid cover square.
      ctx.strokeStyle='#1b273b88';ctx.lineWidth=Math.max(1,cellSize/40);ctx.beginPath();ctx.moveTo(left,top+side*.45);ctx.lineTo(left+side,top+side*.45);ctx.moveTo(left+side*.5,top);ctx.lineTo(left+side*.5,top+side*.45);ctx.stroke();
      const text=cell.cover==='half'?'+2':cell.cover==='three-quarters'?'+5':'X',size=Math.max(9,cellSize*.30);
      ctx.font=`bold ${size}px sans-serif`;const tw=ctx.measureText(text).width;
      ctx.fillStyle='#11171cdd';ctx.fillRect(px+(cellSize-tw)/2-2,py+cellSize*.47,tw+4,size+3);
      ctx.fillStyle=paper;ctx.fillText(text,px+(cellSize-tw)/2,py+cellSize*.47+size);ctx.restore();
    }
    if(known&&rules&&['light','heavy'].includes(cell.obscurement)){
      ctx.save();ctx.beginPath();ctx.rect(px+1,py+1,cellSize-2,cellSize-2);ctx.clip();
      const heavy=cell.obscurement==='heavy';ctx.fillStyle=heavy?'#8f8da6a8':'#b8b5c12b';ctx.fillRect(px,py,cellSize,cellSize);
      ctx.strokeStyle=heavy?'#e5e2f6b0':'#dddce478';ctx.lineWidth=cellSize*(heavy?.06:.035);ctx.lineCap='round';
      for(let i=0;i<(heavy?4:2);i++){
        const y0=py+cellSize*(.21+i*(heavy?.19:.42));ctx.beginPath();ctx.moveTo(px+cellSize*.10,y0);ctx.bezierCurveTo(px+cellSize*.34,y0-cellSize*.15,px+cellSize*.60,y0+cellSize*.16,px+cellSize*.90,y0);ctx.stroke();
      }ctx.restore();
    }
    if (cell?.visibility === 'remembered') { ctx.fillStyle = 'rgba(12,20,30,0.68)'; ctx.fillRect(px, py, cellSize, cellSize); }
    ctx.strokeStyle = known ? '#a6a29466' : '#252c33'; ctx.lineWidth = 1; ctx.strokeRect(px + .5, py + .5, cellSize - 1, cellSize - 1);
  }
  for (let x = 0; x < width; x++) label(ctx, startX + x + 1, margin + x * cellSize + 7, header - 5, 11);
  for (let y = 0; y < height; y++) label(ctx, startY + y + 1, 12, header + y * cellSize + 20, 11);
  for (const object of map.objects ?? []) {
    const objectCell=cells.get(`${object.x},${object.y}`);
    if (!inFrame(object)) continue;
    if (objectCell?.visibility !== 'visible'||objectCell.creaturesVisible===false) continue;
    const px = margin + (object.x - startX) * cellSize, py = header + (object.y - startY) * cellSize;
    ctx.strokeStyle = gold; ctx.lineWidth = 2;
    if (object.kind === 'door') ctx.strokeRect(px + 8, py + 3, cellSize - 16, cellSize - 6);
    else if (object.kind === 'stairs') for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(px + 6, py + 7 + i * 7); ctx.lineTo(px + 14 + i * 5, py + 7 + i * 7); ctx.stroke(); }
    else ctx.strokeRect(px + 7, py + 9, cellSize - 14, cellSize - 18);
  }
  const visibleTokens = [];
  // Paint the controlled character last when figures share a square. A
  // companion must not cover the portrait inside the cyan YOU marker.
  const orderedTokens=own?[...drawableTokens.filter(t=>t!==own),...drawableTokens.filter(t=>t===own)]:drawableTokens;
  for (const token of orderedTokens) {
    const tokenCell=cells.get(`${token.x},${token.y}`);
    if (!inFrame(token)) continue;
    if (tokenCell?.visibility !== 'visible'||(tokenCell.creaturesVisible===false&&token!==own)) continue;
    visibleTokens.push(token);
    const x = margin + (token.x - startX) * cellSize, y = header + (token.y - startY) * cellSize;
    const isOwn=own===token;
    ctx.fillStyle = isOwn?ownColor:token.hostile ? '#aa443e' : gold; ctx.beginPath();ctx.arc(x+cellSize/2,y+cellSize/2,(cellSize-4)/2,0,Math.PI*2);ctx.fill();
    const source = portraits[token.characterId];
    if (source) roundPortrait(ctx, await approvedImage(source), x + 4, y + 4, cellSize - 8);
    else label(ctx, (token.displayName ?? '?').slice(0, 2).toUpperCase(), x + 7, y + cellSize - 10, Math.max(9, cellSize / 3), ink);
    if(isOwn){
      // Keep the marker entirely inside its visible square: no halo can paint
      // unknown neighboring terrain or obscure a second actor's square.
      ctx.strokeStyle='#071b1d';ctx.lineWidth=4;ctx.strokeRect(x+2,y+2,cellSize-4,cellSize-4);
      ctx.strokeStyle=ownColor;ctx.lineWidth=2;ctx.strokeRect(x+2,y+2,cellSize-4,cellSize-4);
      ctx.fillStyle=ownColor;ctx.beginPath();ctx.moveTo(x+cellSize/2,y+3);ctx.lineTo(x+cellSize/2+5,y+8);ctx.lineTo(x+cellSize/2,y+13);ctx.lineTo(x+cellSize/2-5,y+8);ctx.closePath();ctx.fill();
    }
  }
  const occupied=new Map();
  for(const token of visibleTokens){const key=`${token.x},${token.y}`;occupied.set(key,(occupied.get(key)??0)+1);}
  for(const [key,count]of occupied){if(count<2)continue;const [x,y]=key.split(',').map(Number),px=margin+(x-startX)*cellSize+cellSize-9,py=header+(y-startY)*cellSize+cellSize-9;ctx.fillStyle=ink;ctx.beginPath();ctx.arc(px,py,7,0,Math.PI*2);ctx.fill();label(ctx,count,px-3,py+3,9,paper);}
  const footer = header + height * cellSize + 23;
  label(ctx, 'Bright: visible  ·  Dim: remembered  ·  Dark: unknown', margin, footer, 12, paper);
  label(ctx, 'Floor: traversable · Hatched: difficult · Outlined: wall', margin, footer + 20, 11, gold);
  label(ctx, 'Ground: 5 ft · Difficult: 10 ft · Walls block movement & sight', margin, footer + 38, 11, paper);
  if(rules){
    label(ctx,'Cover: +2 half · +5 three quarters · X total (blocked)',margin,footer+56,11,gold);
    label(ctx,'Cover depends on attack direction; bonuses do not add.',margin,footer+70,11,paper);
    label(ctx,'Fog: light = sight checks harder · heavy = creatures obscured',margin,footer+84,11,paper);
  }
  label(ctx, 'Gold outlined square: interactable - Inspect for details', margin, footer + 50 + terrainFooter, 10, gold);
  const legendTokens=own?[own,...visibleTokens.filter(t=>t!==own)]:visibleTokens;
  for (const [i, token] of legendTokens.entries()) {
    const x = margin + (i%slots) * 150, rowOffset=Math.floor(i/slots)*legendRowHeight, source = portraits[token.characterId];
    if (source) roundPortrait(ctx, await approvedImage(source), x, footer + 52+terrainFooter+rowOffset, 40);
    const textX=x+(source?47:0), textWidth=150-(source?47:0)-10;
    // Two measured lines stay inside this token's slot; very long names end in an ellipsis.
    ctx.font='12px sans-serif';
    let remaining=`${token===own?'YOU: ':''}${token.displayName??'Token'}`;
    for(let line=0;line<2&&remaining;line++){
      let count=remaining.length;
      while(count>0&&ctx.measureText(remaining.slice(0,count)+(line===1&&count<remaining.length?'\u2026':'')).width>textWidth)count--;
      if(line===0&&count<remaining.length){const space=remaining.lastIndexOf(' ',count);if(space>0)count=space;}
      const text=remaining.slice(0,count)+(line===1&&count<remaining.length?'\u2026':'');
      label(ctx,text,textX,footer+65+line*15+terrainFooter+rowOffset,12,token===own?ownColor:paper);
      remaining=remaining.slice(count).trimStart();
    }
    label(ctx, `(${token.x + 1}, ${token.y + 1})`, textX, footer + 98+terrainFooter+rowOffset, 11, gold);
  }
  return canvas.toBuffer('image/png');
}

export function renderOverview({ nodes = [], edges = [], currentId, title = 'Discovered routes', level = 'dungeon' }) {
  const canvas = createCanvas(1000, 700), ctx = canvas.getContext('2d');
  ctx.fillStyle = ink; ctx.fillRect(0, 0, 1000, 700); label(ctx, title, 35, 40, 26);
  label(ctx, 'DISCOVERED ROUTES · Diagram, not to scale', 35, 66, 12, gold);
  const known = nodes.filter(n => n.discovered === true);
  const byId = new Map(known.map((n, i) => [n.id, { ...n, px: 100 + Math.min(1, Math.max(0, n.x ?? ((i % 4) / 3))) * 780, py: 130 + Math.min(1, Math.max(0, n.y ?? (Math.floor(i / 4) / Math.max(1, Math.ceil(known.length / 4) - 1)))) * 440 }]));
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b || e.discovered !== true) continue;
    ctx.strokeStyle = '#867856'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    if(e.directed){const angle=Math.atan2(b.py-a.py,b.px-a.px),x=b.px-Math.cos(angle)*28,y=b.py-Math.sin(angle)*28;ctx.fillStyle=gold;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(angle-.45)*13,y-Math.sin(angle-.45)*13);ctx.lineTo(x-Math.cos(angle+.45)*13,y-Math.sin(angle+.45)*13);ctx.closePath();ctx.fill();}
    if(Number.isFinite(e.minutes)&&e.minutes>=0){const text=`${e.minutes} min`,x=(a.px+b.px)/2,y=(a.py+b.py)/2;ctx.font='12px sans-serif';const w=ctx.measureText(text).width;ctx.fillStyle=ink;ctx.fillRect(x-w/2-6,y-17,w+12,22);label(ctx,text,x-w/2,y-2,12,paper);}
  }
  for (const n of byId.values()) {
    ctx.fillStyle = n.id === currentId ? gold : '#56676b';ctx.beginPath();ctx.arc(n.px,n.py,18,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=n.id===currentId?paper:'#9aacaf';ctx.lineWidth=2;ctx.beginPath();ctx.arc(n.px,n.py,23,0,Math.PI*2);ctx.stroke();
    ctx.font='15px sans-serif';const nodeLabel=String(n.name??n.id).slice(0,48);const textWidth=ctx.measureText(nodeLabel).width;const tx=Math.max(35,Math.min(965-textWidth,n.px-textWidth/2));ctx.fillStyle=ink;ctx.fillRect(tx-6,n.py+24,textWidth+12,26);label(ctx,nodeLabel,tx,n.py+42,15);if(n.id===currentId)label(ctx,'CURRENT',n.px-30,n.py-28,11,gold);
  }
  label(ctx, level === 'regional' ? 'Known settlements and routes' : 'Known rooms and passages', 35, 665, 15, gold);
  return canvas.toBuffer('image/png');
}

/** Vignettes must be approved discovery-safe artwork, keyed by room ID, never full secret-bearing floorplans. */
export async function renderIllustratedOverview(map, { roomVignettes = {} } = {}) {
  if (map.level === 'regional') return renderOverview(map);
  // Filter before layout AND asset lookup: hidden entries cannot affect the image or trigger a file read.
  const known = (map.nodes ?? []).filter(n => n.discovered === true);
  const columns = known.length > 1 ? 2 : 1;
  const width = columns === 1 ? 520 : 780;
  const height = Math.max(500, 140 + Math.ceil(known.length / columns) * 280);
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eee4cd'; ctx.fillRect(0, 0, width, height);
  label(ctx, map.title ?? 'Discovered rooms', 32, 42, 30, ink);
  label(ctx, 'Known passages · diagram, not to scale', 32, 76, 20, '#655c48');
  const rooms = new Map(known.map((n, i) => [n.id, { ...n, px: columns === 1 ? width / 2 : 200 + (i % columns) * 380, py: 195 + Math.floor(i / columns) * 280 }]));
  for (const edge of map.edges ?? []) {
    const a = rooms.get(edge.from), b = rooms.get(edge.to);
    if (!a || !b || edge.discovered !== true) continue;
    const bend = (a.px + b.px) / 2 + (a.px === b.px ? 155 : 0);
    const path = () => { ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.bezierCurveTo(bend, a.py, bend, b.py, b.px, b.py); };
    ctx.strokeStyle = '#b6a581'; ctx.lineWidth = 16; path(); ctx.stroke();
    ctx.strokeStyle = '#eee4cd'; ctx.lineWidth = 11; path(); ctx.stroke();
    ctx.strokeStyle = '#655c48'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); path(); ctx.stroke(); ctx.setLineDash([]);
    const x = .125 * a.px + .75 * bend + .125 * b.px, y = (a.py + b.py) / 2;
    if (edge.directed) {
      const angle = Math.atan2(b.py - a.py, b.px - a.px);
      ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10);
      ctx.lineTo(x - Math.cos(angle - .55) * 11, y - Math.sin(angle - .55) * 11);
      ctx.lineTo(x - Math.cos(angle + .55) * 11, y - Math.sin(angle + .55) * 11); ctx.closePath(); ctx.fill();
    }
    if (Number.isFinite(edge.minutes) && edge.minutes >= 0) {
      const text = `${edge.minutes} min`; ctx.font = '18px sans-serif'; const w = ctx.measureText(text).width;
      ctx.fillStyle = '#eee4cd'; ctx.fillRect(x - w / 2 - 5, y + 12, w + 10, 25); label(ctx, text, x - w / 2, y + 31, 18, ink);
    }
  }
  for (const room of rooms.values()) {
    const x = room.px - 146, y = room.py - 78;
    let art;
    if (Object.hasOwn(roomVignettes, room.id)) {
      try {
        const asset = roomVignettes[room.id];
        if (asset && typeof asset === 'object' && !Buffer.isBuffer(asset)) {
          // Grid descriptors are terrain-only art. Secret objects and actors need separate discovery filters.
          if (asset.sceneId !== undefined && asset.sceneId !== map.id) throw Error('Artwork belongs to another scene.');
          const g = asset.grid;
          if (!g || ![g.x, g.y, g.width, g.height].every(Number.isInteger) ||
              g.x < 0 || g.y < 0 || g.width < 1 || g.height < 1 ||
              g.x + g.width > 25 || g.y + g.height > 25 || !Array.isArray(room.knownCells)) throw Error('Missing terrain mask.');
          const cells = new Set(room.knownCells.filter(c => c && Number.isInteger(c.x) && Number.isInteger(c.y) &&
            c.x >= g.x && c.y >= g.y && c.x < g.x + g.width && c.y < g.y + g.height).map(c => `${c.x},${c.y}`));
          if (!cells.size) throw Error('No known terrain.');
          const source = await approvedImage(asset.source);
          if (source.width % g.width || source.height % g.height) throw Error('Artwork must align with whole grid pixels.');
          const masked = createCanvas(source.width, source.height), safe = masked.getContext('2d');
          const tw = source.width / g.width, th = source.height / g.height;
          safe.imageSmoothingEnabled = false;
          // Sanitize at source resolution BEFORE any scaling, so filtering cannot sample unknown pixels.
          for (let cy = 0; cy < g.height; cy++) for (let cx = 0; cx < g.width; cx++) {
            if (cells.has(`${g.x + cx},${g.y + cy}`)) safe.drawImage(source, cx * tw, cy * th, tw, th, cx * tw, cy * th, tw, th);
          }
          art = masked;
        } else art = await approvedImage(asset); // Plain assets must be safe to reveal when the room is discovered.
      } catch { /* Missing masks and unavailable artwork keep the known-room text fallback usable. */ }
    }
    ctx.fillStyle = '#ded1b4'; ctx.fillRect(x, y, 292, 156);
    if (art) {
      // Contain the full approved vignette rather than cropping away authored landmarks or exits.
      const scale = Math.min(280 / art.width, 144 / art.height), w = art.width * scale, h = art.height * scale;
      ctx.drawImage(art, room.px - w / 2, room.py - h / 2, w, h);
    } else {
      label(ctx, 'Room illustration', x + 42, room.py - 5, 23, '#655c48');
      label(ctx, 'unavailable', x + 77, room.py + 25, 22, '#655c48');
    }
    ctx.strokeStyle = room.id === map.currentId ? '#876719' : '#8e7b54'; ctx.lineWidth = room.id === map.currentId ? 5 : 2;
    ctx.strokeRect(x - 3, y - 3, 298, 162);
    const text = String(room.name ?? room.id).slice(0, 80); ctx.font = '26px sans-serif';
    let first = text, rest = '';
    while (first.length && ctx.measureText(first).width > 300) { rest = first.slice(-1) + rest; first = first.slice(0, -1); }
    label(ctx, first, room.px - ctx.measureText(first).width / 2, room.py + 115, 26, ink);
    if (rest) { while (rest.length && ctx.measureText(rest + '…').width > 300) rest = rest.slice(0, -1); label(ctx, rest + '…', room.px - ctx.measureText(rest + '…').width / 2, room.py + 145, 26, ink); }
    if (room.id === map.currentId) { ctx.fillStyle = '#876719'; ctx.fillRect(x, y - 27, 134, 26); label(ctx, 'YOU ARE HERE', x + 8, y - 8, 17, '#fff6dc'); }
  }
  if (!known.length) label(ctx, 'No rooms discovered yet.', 32, 170, 27, ink);
  label(ctx, 'Viewing this map does not move your character.', 32, height - 20, 20, '#655c48');
  return canvas.toBuffer('image/png');
}

/** Call with the PUBLIC projection's participants only; private actors are rejected by default. */
export async function renderPublicCombatCard({ title = 'Combat begins', summary = '', participants = [] }, { portraits = {}, sceneArt } = {}) {
  const canvas = createCanvas(1000, 440), ctx = canvas.getContext('2d'); ctx.fillStyle = ink; ctx.fillRect(0, 0, 1000, 440);
  if (sceneArt) { ctx.drawImage(await approvedImage(sceneArt), 0, 0, 1000, 440); ctx.fillStyle = 'rgba(10,16,22,0.74)'; ctx.fillRect(0, 0, 1000, 440); }
  // Discord supplies the complete accessible caption below the image. Keep its
  // visual counterpart inside the frame even for long action summaries/names.
  const fit = (value, x, y, size, width, color = paper) => {
    ctx.font = `${size}px sans-serif`;
    const letters = [...String(value ?? '')];
    while (letters.length && ctx.measureText(letters.join('')).width > width) letters.pop();
    const shortened = letters.length < [...String(value ?? '')].length;
    if (shortened) { while (letters.length && ctx.measureText(`${letters.join('')}…`).width > width) letters.pop(); }
    ctx.fillStyle = color;
    ctx.fillText(`${letters.join('')}${shortened ? '…' : ''}`, x, y);
  };
  fit(title, 35, 45, 28, 930);
  const words = String(summary).split(/\s+/); let line = '', lines = [];
  ctx.font = '17px sans-serif';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > 930 && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  fit(lines[0] ?? '', 35, 397, 17, 930);
  fit(lines.slice(1).join(' '), 35, 422, 17, 930);
  ctx.fillStyle = '#384149'; ctx.fillRect(30, 330, 940, 3);
  const visible = participants.filter(p => p.publiclyVisible === true).slice(0, 6);
  for (let i = 0; i < visible.length; i++) {
    const p = visible[i], x = 65 + i * 150;
    if (portraits[p.characterId]) { const art = await approvedImage(portraits[p.characterId]); cropPortrait(ctx, art, x, 175, 120); }
    else { ctx.fillStyle = p.hostile ? '#9e5148' : gold; ctx.fillRect(x + 35, 215, 50, 95); }
    fit(p.name, x, 355, 15, 140);
  }
  return canvas.toBuffer('image/png');
}
