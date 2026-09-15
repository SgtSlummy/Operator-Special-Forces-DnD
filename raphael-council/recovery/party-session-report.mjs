import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runPartySession } from './party-session.mjs';
import { renderTacticalMap } from './map-renderer.mjs';
import { areaMapState, renderAreaMap } from './area-map-renderer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artRoot = resolve(root, '../campaign-art/witnesslight');
const tacticalMapAssets = {
  'saltglass-party-shore': join(artRoot, 'on-discovery', 'saltglass-shore-overhead-sd.png'),
  'abbey-archive': join(artRoot, 'on-discovery', 'drowned-abbey-tactical-map.png'),
};
const output = resolve(process.env.RAPHAEL_PARTY_REPORT_DIR || join(root, 'tmp', 'party-session'));
const imageDir = join(output, 'images');
const portraits = Object.fromEntries(['branna', 'pip', 'kael', 'brine'].map(id => [id, join(artRoot, 'party', `portrait-${id}.png`)]));
const escapeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');

const manifest = JSON.parse(await readFile(join(artRoot, 'manifest.json'), 'utf8'));
const assets = new Map((manifest.assets ?? []).filter(asset => asset.status === 'generated').map(asset => [asset.id, asset.file]));

await mkdir(imageDir, { recursive: true });
const result = await runPartySession({ temporaryRoot: join(output, '.runtime', `run-${Date.now()}`) });
await copyFile(resolve(root, '../campaign-art/witnesslight/party/saltglass-party.png'), join(imageDir, 'saltglass-party.png'));
for (const [id, path] of Object.entries(portraits)) await copyFile(path, join(imageDir, `portrait-${id}.png`));
const copied = new Map();
for (const step of result.steps) {
  if (copied.has(step.image.approvedImage)) continue;
  const asset = assets.get(step.image.approvedImage);
  if (!asset) continue;
  const name = `${step.image.approvedImage}.png`;
  await copyFile(join(artRoot, asset), join(imageDir, name));
  copied.set(step.image.approvedImage, name);
}
const steps = [];
const sceneImagesByMap = new Map();
for (let index = 0; index < result.steps.length; index += 1) {
  const original = result.steps[index];
  const mismatch = original.map.id !== original.location.id;
  if (!mismatch && copied.has(original.image.approvedImage)) {
    sceneImagesByMap.set(original.map.id, `images/${copied.get(original.image.approvedImage)}`);
  }
  const step = {
    ...original,
    mapScene: { id: original.map.id, title: original.map.id === 'saltglass-party-shore' ? 'Saltglass Shore' : 'Encounter map' },
    displayWarnings: mismatch ? ['The story has moved ahead of the board. This map still shows Saltglass Shore; an Abbey map transition has not been committed.'] : [],
  };
  const mapImages = {};
  for (const viewer of ['admin', ...Object.keys(step.viewerSnapshots ?? {})]) {
    const file = join(imageDir, `map-${viewer}-${String(index + 1).padStart(2, '0')}.png`);
    await renderTacticalMap(step, file, { viewer, portraits, backgroundPath: tacticalMapAssets[step.map.id] ?? null });
    mapImages[viewer] = `images/map-${viewer}-${String(index + 1).padStart(2, '0')}.png`;
  }
  const tacticalFile = `map-admin-tactical-${String(index + 1).padStart(2, '0')}.png`;
  await renderTacticalMap(step, join(imageDir, tacticalFile), { portraits, showTactics: true, backgroundPath: tacticalMapAssets[step.map.id] ?? null });
  mapImages.adminTactical = `images/${tacticalFile}`;
  let areaMap = null;
  if (areaMapState(step, steps)) {
    const areaFile = `area-${String(index + 1).padStart(2, '0')}.png`;
    const areaState = await renderAreaMap(step, join(imageDir, areaFile), {
      backgroundPath: join(artRoot, 'on-discovery', 'saltglass-known-locations.png'), history: steps,
    });
    areaMap = { ...areaState, imageFile: `images/${areaFile}` };
  }
  steps.push({ ...step, imageFile: sceneImagesByMap.get(step.map.id) ?? null,
    sceneImageTitle: step.mapScene.title, mapImages, areaMap });
}
const html = `<!doctype html><meta charset="utf-8"><title>Three-player Saltglass Shore replay</title>
<style>body{margin:0;background:#0b0a13;color:#f7f3e8;font:15px system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:28px}h1,h2,h3{font-family:Georgia,serif;color:#f3c969}.hero,.step{margin:24px 0;padding:20px;border:1px solid #776653;border-radius:14px;background:#17131d}.hero img{width:100%;max-height:460px;object-fit:cover;border-radius:10px}.grid{display:grid;grid-template-columns:minmax(420px,1fr) minmax(360px,1fr);gap:18px}.scene{width:100%;border-radius:10px;border:1px solid #776653;background:#111019}.scene img{width:100%;display:block;border-radius:10px}.facts{white-space:pre-wrap;line-height:1.5;color:#d8cbbb}.tag{display:inline-block;margin:3px;padding:4px 8px;border-radius:99px;background:#352d40;color:#f3c969;font-size:12px}pre{overflow:auto;background:#0e0c13;padding:12px;border-radius:8px;color:#d8cbbb}.party{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.card{padding:12px;border:1px solid #554754;border-radius:10px;background:#211b27}.card strong{color:#f3c969}.component-columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.component-columns ul{margin-top:4px}@media(max-width:900px){.grid,.component-columns,.party{grid-template-columns:1fr}}</style>
<main><section class="hero"><h1>Behind the Veil · Saltglass Shore</h1><p>Three-player level-1 replay. Every movement cell creates a new authoritative image request and map snapshot.</p><img src="images/saltglass-party.png" alt="The three-player party at Saltglass Shore"><div id="party"></div><div id="rules"></div></section><div id="replay"></div><script>
const data=${escapeJson(steps)}, party=${escapeJson(result.party)}, rules=${escapeJson(result.party ? result.steps[0].rulesComponents : {})};
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
document.getElementById('party').innerHTML='<h2>Generated level-1 party</h2><div class="party">'+party.map(p=>'<div class="card"><strong>'+esc(p.name)+'</strong><br>'+esc(p.ancestry)+' '+esc(p.className)+' · level '+p.level+'<br>HP '+p.hp+' · AC '+p.ac+' · Speed '+p.speed+'<br>Weapon: '+esc(p.weapon.name)+'<br>Inventory: '+esc(p.inventory.join(', '))+(p.spellcasting?'<br>Spells: '+esc(p.spellcasting.cantrips.join(', '))+'; slots '+esc(JSON.stringify(p.spellcasting.slots)):'')+'</div>').join('')+'</div>';
document.getElementById('rules').innerHTML='<h2>Simulated handbook components</h2><div class="component-columns"><div><h3>DM-facing</h3><ul>'+rules.dmHandbook.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div><div><h3>Player-facing</h3><ul>'+rules.playerHandbook.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div></div>';
function map(step){const size=48,w=step.map.width*size,h=step.map.height*size,blocked=new Set(step.map.blocked.map(p=>p.x+','+p.y)),difficult=new Set(step.map.difficult.map(p=>p.x+','+p.y));let out='<svg class="scene" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(step.location.title)+' map">';for(let y=0;y<step.map.height;y++)for(let x=0;x<step.map.width;x++){const k=x+','+y,fill=blocked.has(k)?'#534957':difficult.has(k)?'#6b5c3a':'#24212a';out+='<rect x="'+(x*size)+'" y="'+(y*size)+'" width="'+(size-2)+'" height="'+(size-2)+'" rx="6" fill="'+fill+'" stroke="#776653"/><text x="'+(x*size+7)+'" y="'+(y*size+16)+'" fill="#d0b8a3" font-size="10">'+String.fromCharCode(65+x)+(y+1)+'</text>';}for(const a of step.actors){const x=a.x,y=a.y;out+='<circle cx="'+((x+.5)*size)+'" cy="'+((y+.5)*size)+'" r="15" fill="'+(a.defeated?'#57505a':a.team==='party'?'#5c8da1':'#9a5b64')+'" stroke="#e7d1b1"/><text x="'+((x+.5)*size)+'" y="'+((y+.5)*size+4)+'" text-anchor="middle" fill="white" font-size="11">'+esc(a.name.slice(0,2).toUpperCase())+'</text>';}return out+'</svg>'}
document.getElementById('replay').innerHTML=data.map((s,i)=>'<article class="step"><h2>'+(i+1)+'. '+esc(s.screen)+'</h2><div class="tag">Game revision '+esc(s.gameRevision)+'</div><div class="tag">Image revision '+esc(s.sceneRevision)+'</div><div class="tag">'+esc(s.image.approvedImage)+'</div><p class="facts"><strong>'+esc(s.characterQuestion)+'</strong>\\n'+esc(s.location.description)+'</p><div class="grid"><div><h3>Board · '+s.map.width+' × '+s.map.height+'</h3>'+map(s)+'<p class="facts">Blocked: '+esc(JSON.stringify(s.map.blocked))+'\\nDifficult terrain: '+esc(JSON.stringify(s.map.difficult))+'</p></div><div><h3>Location image</h3><img class="scene" src="'+esc(s.imageFile)+'" alt="'+esc(s.location.title)+' at revision '+esc(s.sceneRevision)+'"><h3>Buttons and action</h3><p class="facts">'+esc(s.buttons.join(' · '))+'</p><pre>'+esc(JSON.stringify({action:s.action,notes:s.notes,initiative:s.initiative},null,2))+'</pre></div></div></article>').join('');</script></main>`;
await writeFile(join(output, 'index-v3.html'), html, 'utf8');
await writeFile(join(output, 'session.json'), JSON.stringify({ ...result, steps }, null, 2), 'utf8');
const deckBuild = spawnSync(process.execPath, [join(root, 'recovery', 'party-deck-report.mjs')], {
  cwd: root, encoding: 'utf8', env: { ...process.env, RAPHAEL_PARTY_REPORT_DIR: output }, timeout: 30_000,
});
if (deckBuild.status !== 0) throw new Error('Deck build failed: ' + (deckBuild.stderr || deckBuild.error?.message || 'unknown error'));
await writeFile(join(output, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saltglass Shore replay</title><script>location.replace(new URLSearchParams(location.search).get("replay") === "v3" ? "index-v3.html" : "deck.html")</script><p><a href="deck.html">Open the accessible replay</a> · <a href="index-v3.html">Open the legacy replay</a></p></html>', 'utf8');
console.log(JSON.stringify({ output, steps: steps.length, checkpoint: result.checkpoint }, null, 2));
