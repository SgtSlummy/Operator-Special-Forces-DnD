import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { panels, entries, secret, feedFor } from './data.mjs';
import { renderScreen, renderRecap, initialState, esc } from './views.mjs';

test('the storyboard covers exactly 30 unique ordered frames and all six acts',()=>{
  assert.deepEqual(panels.map(p=>p.id),Array.from({length:30},(_,i)=>i+1));
  assert.deepEqual([...new Set(panels.map(p=>p.act))],[1,2,3,4,5,6]);
  for(const p of panels)for(const field of ['title','role','type','dialogue','action','next'])assert.ok(p[field],`Frame ${p.id}: ${field}`);
});
test('every player screen excludes DM secrets and unpublished read-aloud controls',()=>{
  for(const p of panels.filter(p=>p.role==='Player')){
    const html=renderScreen(p,initialState());
    assert.ok(!html.includes(secret),`Secret in player frame ${p.id}`);
    assert.ok(!html.includes('data-action="regenerate"'),`DM control in player frame ${p.id}`);
    assert.ok(!html.includes('data-action="read"'),`DM control in player frame ${p.id}`);
  }
});
test('DM drafts are private and do not exist in the shared source record or recap',()=>{
  assert.ok(renderScreen(panels[5]).includes('PRIVATE · DM ONLY'));
  assert.ok(renderScreen(panels[5]).includes(secret));
  assert.ok(!JSON.stringify(entries).includes(secret));
  const report=renderRecap();assert.ok(!report.includes(secret));assert.ok(!report.includes('private encounter note'));
});
test('summaries cite existing past evidence; chronology and corrections remain coherent',()=>{
  const byId=new Map(entries.map(e=>[e.id,e]));
  for(const e of entries)for(const id of e.refs??[]){assert.ok(byId.has(id));assert.ok(byId.get(id).at<=e.at);}
  assert.ok(byId.get('E08').text.includes('Morrow'));
  assert.ok(byId.get('E09').text.includes('Mara'));
  assert.ok(byId.get('E10').text.includes('Mara'));
  assert.equal(byId.get('E10').replaces,'E08');
  assert.ok(renderRecap().includes('kept a 16 over a 7'));
  assert.ok(renderRecap().includes('total of 19'));
});
test('chronicle filters combine speaker, type, time and case-insensitive search',()=>{
  assert.deepEqual(feedFor(30,{tag:'TRANSCRIPT',speaker:'Maren',time:'early',query:'SPAR'}).map(e=>e.id),['E03']);
  assert.deepEqual(feedFor(20,{tag:'CORRECTION'}),[]);
  assert.deepEqual(feedFor(21,{tag:'CORRECTION'}).map(e=>e.id),['E09']);
  assert.deepEqual(feedFor(30,{query:'no-such-text'}),[]);
});
test('all rendered image states preserve old-view labels and actionable gaps',()=>{
  assert.ok(renderScreen(panels[16]).includes('earlier'));
  assert.ok(renderScreen(panels[24]).includes('No words were invented'));
  assert.ok(renderScreen(panels[21]).includes('countdown frozen'));
  assert.ok(renderScreen(panels[22],{...initialState(),resumed:true}).includes('countdown resumed'));
});
test('portable recap embeds art, preserves all source entries, and has no secret',async()=>{
  const html=await readFile(new URL('recap.html',import.meta.url),'utf8');
  assert.ok(html.includes('data:image/jpeg;base64,'));assert.ok(!html.includes('src="assets/'));
  for(const entry of entries)assert.ok(html.includes(`id="${entry.id}"`));
  assert.ok(!html.includes(secret));
  const manifest=JSON.parse(await readFile(new URL('assets/manifest.json',import.meta.url),'utf8'));
  for(const name of ['shore','abbey']){
    const big=manifest.find(a=>a.file===name+'.jpg'),small=manifest.find(a=>a.file===name+'-small.jpg');
    assert.equal(small.width,600);assert.ok(small.bytes<big.bytes);
  }
});
test('print edition has every frame and the app contains no live capture or outbound API calls',async()=>{
  const html=await readFile(new URL('storyboard.html',import.meta.url),'utf8');
  assert.equal((html.match(/class="print-panel"/g)??[]).length,30);
  const app=await readFile(new URL('app.mjs',import.meta.url),'utf8');
  for(const forbidden of ['getUserMedia','fetch(','WebSocket(','api.openai.com','discord.com/api'])assert.ok(!app.includes(forbidden));
  assert.equal(esc('<script>"&'),'&lt;script&gt;&quot;&amp;');
});

test('the presentation contains every numbered frame, embedded artwork and working navigation definitions',async()=>{
  const html=await readFile(new URL('presentation.html',import.meta.url),'utf8');
  assert.equal((html.match(/class="presentation-slide"/g)??[]).length,30);
  for(const p of panels)assert.ok(html.includes(`data-number="${p.id}"`));
  assert.equal((html.match(/class="slide-notes"/g)??[]).length,30);
  assert.ok(html.includes('id="presentation-images"'));assert.ok(html.includes('data:image/jpeg;base64,'));
  assert.ok(!html.includes('<script src='));assert.ok(!html.includes('src="assets/'));
  for(const control of ['previous','next','slide-select','fullscreen','download','zoom','index-button'])assert.ok(html.includes(`id="${control}"`));
});
