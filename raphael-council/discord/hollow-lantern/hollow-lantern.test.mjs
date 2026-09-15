import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildPanel } from './components.mjs';
import { ControlStore, createHollowLanternAdapter } from './adapter.mjs';
import { renderTacticalMap, renderOverview, renderPublicCombatCard } from './renderers.mjs';

function walk(value) { return [value, ...Object.values(value ?? {}).flatMap(v => Array.isArray(v) ? v.flatMap(walk) : typeof v === 'object' && v ? walk(v) : [])]; }
test('native layout uses dropdowns, keeps public fields private and respects limits', () => {
  for (const audience of ['public', 'player', 'gm']) for (const mode of ['combat', 'shop', 'exploration']) {
    const out = buildPanel({ audience, mode, revision: 1, title: 'PRIVATE TITLE', summary: 'SECRET ROOM', publicSummary: 'The party arrives.', actor: { inventory: [{ name: 'SECRET ITEM', quantity: 1 }] } }, () => 'hl:123');
    assert.ok(walk(out).filter(v => v.type).length <= 40);
    assert.ok(walk(out).filter(v => v.type === 1).every(v => v.components.length <= 5));
    if (audience === 'public') assert.doesNotMatch(JSON.stringify(out), /PRIVATE TITLE|SECRET/);
    else assert.ok(walk(out).some(v => v.type === 3));
  }
});
test('tokens expire and store is bounded', () => {
  let now = 1; const store = new ControlStore({ now: () => now, ttlMs: 10, capacity: 1 });
  const one = store.issue({ userId: '1' }); const two = store.issue({ userId: '2' });
  assert.equal(store.get(one), null); assert.ok(store.get(two)); now = 11; assert.equal(store.get(two), null);
});
test('adapter rejects copied, stale and revoked controls; dispatches current engine action', async () => {
  const store = new ControlStore(); let allowed = true, revision = 4; const calls = [];
  const adapter = createHollowLanternAdapter({ campaignId: 'c', tokenStore: store, authorize: async () => allowed, resolveActor: async () => 'a', engine: { project: async () => ({ revision, actions: [{ id: 'attack:t', payload: { targetId: 't' } }] }), command: async c => calls.push(c) } });
  const id = store.issue({ campaignId: 'c', userId: 'u', actorId: 'a', audience: 'player', revision: 4, actionId: 'attack:t' });
  const replies = []; const interaction = { customId: id, id: 'interaction', user: { id: 'bad' }, reply: async p => replies.push(p), deferReply: async () => {}, editReply: async p => replies.push(p) };
  await adapter.handleInteraction(interaction); assert.equal(calls.length, 0);
  interaction.user.id = 'u'; revision = 5; await adapter.handleInteraction(interaction); assert.equal(calls.length, 0);
  revision = 4; allowed = false; await adapter.handleInteraction(interaction); assert.equal(calls.length, 0);
  allowed = true; await adapter.handleInteraction(interaction); assert.equal(calls.length, 1); assert.equal(calls[0].expectedRevision, 4); assert.deepEqual(calls[0].payload, { targetId: 't' });
});
test('flattened unknown cells are identical despite secret terrain, tokens and background', async () => {
  const art = createCanvas(64, 64); art.getContext('2d').fillStyle = 'red'; art.getContext('2d').fillRect(0, 0, 64, 64);
  const map = { width: 2, height: 2, cells: [{ x: 0, y: 0, visibility: 'visible', terrain: 'floor' }] };
  const plain = await loadImage(await renderTacticalMap(map));
  const hidden = await loadImage(await renderTacticalMap({ ...map, cells: [...map.cells, { x: 1, y: 1, visibility: 'unknown', terrain: 'door' }], tokens: [{ x: 1, y: 1, displayName: 'SECRET' }] }, { background: art.toBuffer('image/png') }));
  const pixels = img => { const c = createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); return c.getContext('2d').getImageData(73, 103, 30, 30).data; };
  assert.deepEqual(pixels(plain), pixels(hidden));
});
test('undiscovered overview nodes and private combat participants never affect image', async () => {
  assert.deepEqual(renderOverview({}), renderOverview({ nodes: [{ id: 'secret', name: 'Secret', discovered: false }] }));
  assert.deepEqual(await renderPublicCombatCard({}), await renderPublicCombatCard({ participants: [{ name: 'SECRET', publiclyVisible: false }] }));
});

test('dropdown choices remain scoped and modal fields reach authoritative command', async () => {
  const store = new ControlStore(), calls = [], replies = []; let modal;
  const scope = { campaignId: 'c', userId: 'u', actorId: 'a', audience: 'player', revision: 2 };
  const adapter = createHollowLanternAdapter({ campaignId: 'c', tokenStore: store, authorize: async () => true, resolveActor: async () => 'a', engine: { project: async () => ({ revision: 2, actions: [{ id: 'describe', fields: [{ id: 'text', label: 'What do you do?' }] }] }), command: async c => calls.push(c) } });
  const interaction = { customId: store.issue({ ...scope, select: true }), values: [store.issue({ ...scope, actorId: 'other', actionId: 'describe' })], id: 'i', user: { id: 'u' }, reply: async p => replies.push(p), showModal: async p => { modal = p; }, deferReply: async () => {}, editReply: async () => {} };
  await adapter.handleInteraction(interaction); assert.equal(modal, undefined); assert.equal(replies.length, 1);
  interaction.values = [store.issue({ ...scope, actionId: 'describe', opensModal: true })];
  await adapter.handleInteraction(interaction); assert.equal(modal.components[0].type, 18); assert.equal(modal.components[0].component.custom_id, 'text'); assert.equal(calls.length, 0);
  interaction.customId = modal.custom_id; interaction.isModalSubmit = () => true; interaction.fields = { getTextInputValue: () => 'I listen at the door.' };
  await adapter.handleInteraction(interaction); assert.equal(calls[0].payload.text, 'I listen at the door.');
});

test('public scope resolves GM without a player character and delegates real onboarding', async () => {
  const store = new ControlStore(), projections = [], joins = [];
  const adapter = createHollowLanternAdapter({ campaignId: 'c', tokenStore: store, resolveScope: async () => ({ audience: 'gm' }), authorize: async () => true, onJoin: async (_i, context) => joins.push(context), engine: { project: async scope => { projections.push(scope); return { revision: 1 }; }, command: async () => {} } });
  const interaction = { customId: store.issue({ campaignId: 'c', audience: 'public', navigation: 'character' }), user: { id: 'dm' }, deferReply: async () => {}, editReply: async () => {} };
  await adapter.handleInteraction(interaction); assert.equal(projections[0].audience, 'gm'); assert.equal(projections[0].actorId, undefined);
  interaction.customId = store.issue({ campaignId: 'c', audience: 'public', navigation: 'join' });
  await adapter.handleInteraction(interaction); assert.equal(joins.length, 1); assert.equal(projections.length, 1);
});

test('inventory and grouped menus remain below Discord limits with maximum content', () => {
  const actions = ['use', 'equip', 'drop', 'buy'].flatMap(group => Array.from({ length: 30 }, (_, i) => ({ id: `${group}:${i}`, group, label: `Item ${i}`, description: 'Long detail '.repeat(200) })));
  const view = { audience: 'player', mode: 'shop', title: 'Merchant', summary: 'Summary '.repeat(200), actor: { inventory: Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}`, description: 'Detail '.repeat(300), quantity: 1 })) }, stock: Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, name: `Stock ${i}`, price: 10, quantity: 1 })), actions };
  for (const options of [{ tab: 'inventory' }, { tab: 'map', group: 'buy' }, { tab: 'map' }, { tab: 'help' }]) {
    const payload = buildPanel(view, () => 'hl:example', options), components = walk(payload).filter(n => n.type);
    assert.ok(components.length <= 40, `${components.length} components`);
    assert.ok(components.filter(n => n.type === 10).reduce((n, t) => n + t.content.length, 0) <= 4000);
    if (options.tab !== 'map') assert.doesNotMatch(JSON.stringify(payload), /Merchant stock|Choose your next action/);
  }
  const payload = buildPanel({ audience: 'player', mode: 'combat', actions: [{ id: 'end_turn', group: 'end-turn' }] }, data => JSON.stringify(data));
  assert.equal(walk(payload).find(n => n.label === 'End Turn').custom_id, '{"actionId":"end_turn"}');
  assert.equal(walk(buildPanel(view, () => 'hl:example', { tab: 'inventory' })).find(n => n.label === 'Previous').disabled, true);
});

test('late render failure yields a safe V2 error without private error details', async () => {
  const store = new ControlStore(), replies = [];
  const adapter = createHollowLanternAdapter({ campaignId: 'c', tokenStore: store, resolveActor: async () => 'a', authorize: async () => true, engine: { project: async () => ({ revision: 1, map: { width: 999, height: 2, cells: [] } }), command: async () => {} } });
  await adapter.handleInteraction({ customId: store.issue({ campaignId: 'c', audience: 'player', userId: 'u', actorId: 'a', revision: 1 }), user: { id: 'u' }, deferReply: async () => {}, editReply: async p => replies.push(p) });
  assert.equal(replies[0].flags, 32768); assert.doesNotMatch(JSON.stringify(replies), /Invalid map dimensions|999/); assert.deepEqual(replies[0].attachments, []);
});

test('private map is delivered as a flattened attachment and public card never includes it', async () => {
  const adapter = createHollowLanternAdapter({ campaignId: 'c', authorize: async () => true, resolveActor: async () => 'a', engine: { project: async () => ({ revision: 1, map: { width: 2, height: 2, cells: [] } }), command: async () => {} } });
  const privatePanel = await adapter.panel({ userId: 'u', actorId: 'a' });
  assert.ok(Buffer.isBuffer(privatePanel.files[0].attachment));
  const publicPanel = await adapter.panel({ userId: 'u', audience: 'public' });
  assert.equal(publicPanel.files, undefined); assert.doesNotMatch(JSON.stringify(publicPanel), /character-map/);
});

test('hidden tokens and objects never load portrait sources or change map pixels', async () => {
  const map = { width: 2, height: 2, cells: [{ x: 0, y: 0, visibility: 'visible', terrain: 'floor' }] };
  assert.deepEqual(await renderTacticalMap(map), await renderTacticalMap({ ...map, tokens: [{ characterId: 'secret', x: 1, y: 1, displayName: 'SECRET' }], objects: [{ x: 1, y: 1, kind: 'door' }] }, { portraits: { secret: 'https://do-not-fetch.invalid/portrait.png' } }));
  await assert.rejects(renderTacticalMap(map, { background: 'https://do-not-fetch.invalid/map.png' }), /approved local/);
  assert.deepEqual(await renderPublicCombatCard({}), await renderPublicCombatCard({ participants: [{ characterId: 'secret', name: 'SECRET', publiclyVisible: false }] }, { portraits: { secret: 'https://do-not-fetch.invalid/portrait.png' } }));
});

test('map level navigation preserves actor scope and never dispatches gameplay command', async () => {
  const store = new ControlStore(), projects = [], commands = [], edits = [];
  const adapter = createHollowLanternAdapter({ campaignId: 'c', tokenStore: store, authorize: async () => true, resolveActor: async () => 'a', engine: { project: async scope => { projects.push(scope); return { revision: 7 }; }, command: async c => commands.push(c) } });
  const payload = await adapter.panel({ userId: 'u', actorId: 'a' });
  const selector = walk(payload).find(n => n.placeholder === 'Map scale');
  const regional = selector.options.find(n => n.label.startsWith('Regional'));
  await adapter.handleInteraction({ customId: selector.custom_id, values: [regional.value], user: { id: 'u' }, deferReply: async () => {}, editReply: async p => edits.push(p) });
  assert.equal(projects.at(-1).mapLevel, 'regional'); assert.equal(projects.at(-1).actorId, 'a'); assert.equal(projects.at(-1).audience, 'player'); assert.equal(commands.length, 0);
  const navigation = walk(edits[0]).find(n => n.placeholder === 'Open your character menu');
  assert.equal(store.get(navigation.options[0].value).mapLevel, 'regional');
});

test('only known EngineError reasons are displayed privately', async () => {
  const store = new ControlStore(), replies = [];
  const adapter = createHollowLanternAdapter({ campaignId: 'c', tokenStore: store, resolveActor: async () => 'a', authorize: async () => true, engine: { project: async () => { const e = new Error('Not enough movement'); e.name = 'EngineError'; e.code = 'movement_exhausted'; throw e; }, command: async () => {} } });
  await adapter.handleInteraction({ customId: store.issue({ campaignId: 'c', audience: 'player', userId: 'u', actorId: 'a', revision: 1 }), user: { id: 'u' }, deferReply: async () => {}, editReply: async p => replies.push(p) });
  assert.match(replies[0].components[0].content, /Not enough movement/); assert.doesNotMatch(JSON.stringify(replies), /stack/);
});
test('DM actor selection opens a private NPC control scope and can return to the DM table',async()=>{
 const store=new ControlStore(),scopes=[],edits=[];
 const adapter=createHollowLanternAdapter({campaignId:'c',tokenStore:store,resolveScope:async()=>({audience:'gm'}),authorize:async s=>s.userId==='dm',engine:{project:async s=>{scopes.push(s);return {revision:1,controllableActors:[{id:'enemy',name:'Sentinel'}]};},command:async()=>{throw new Error('navigation must not mutate');}}});
 const payload=await adapter.panel({userId:'dm',audience:'gm'});const selector=walk(payload).find(c=>c.placeholder==='Control a character or NPC');
 await adapter.handleInteraction({customId:selector.custom_id,values:[selector.options[0].value],user:{id:'dm'},deferReply:async()=>{},editReply:async p=>edits.push(p)});
 assert.equal(scopes.at(-1).actorId,'enemy');assert.equal(scopes.at(-1).audience,'player');const back=walk(edits[0]).find(c=>c.label==='Return to DM table');assert.ok(back);
 await adapter.handleInteraction({customId:back.custom_id,user:{id:'dm'},deferReply:async()=>{},editReply:async p=>edits.push(p)});assert.equal(scopes.at(-1).audience,'gm');assert.equal(scopes.at(-1).actorId,undefined);
});
test('failed response retains a scoped original-action recovery control and shows recovered receipt',async()=>{
 const store=new ControlStore(),calls=[],edits=[];let revision=1;
 const adapter=createHollowLanternAdapter({campaignId:'c',tokenStore:store,resolveActor:async()=> 'a',authorize:async s=>s.userId==='u',engine:{project:async()=>({revision,actions:revision===1?[{id:'move',payload:{x:2,y:3},fields:[]}]:[]}),command:async request=>{calls.push(request);if(calls.length===1){revision=2;throw new Error('response lost');}return {revision:2,replayed:true,result:{message:'Moved one square',total:18,secret:'SECRET'}};}}});
 const original=store.issue({campaignId:'c',userId:'u',actorId:'a',audience:'player',revision:1,commandId:'original',actionId:'move'});
 const interaction={customId:original,user:{id:'u'},deferReply:async()=>{},editReply:async p=>edits.push(p)};await adapter.handleInteraction(interaction);
 const recovery=walk(edits[0]).find(c=>c.label==='Recover original action');assert.ok(recovery);await adapter.handleInteraction({...interaction,customId:recovery.custom_id});assert.deepEqual(calls[0],calls[1]);assert.match(JSON.stringify(edits.at(-1)),/Original result recovered/);assert.doesNotMatch(JSON.stringify(edits.at(-1)),/SECRET/);
});

test('character sheet pages keep all skills and paginated feature resolution reachable',()=>{
 const issued=[];const issue=data=>{issued.push(data);return 'hl:sheet';};
 const view={audience:'player',actor:{name:'Mara',skills:{athletics:5,perception:3},sheet:{features:[{id:'second-wind',resolution:'automated'},{id:'weapon-mastery',resolution:'dm-mediated'},{id:'defense',resolution:'automated'},{id:'remarkable-athlete',resolution:'dm-mediated'}],spellcasting:null}}};
 const skills=buildPanel(view,issue,{tab:'skills'});assert.match(JSON.stringify(skills),/athletics/);assert.match(JSON.stringify(skills),/perception/);
 assert.ok(issued.some(data=>data.navigation==='training'));
 const features=buildPanel(view,issue,{tab:'features',page:1});assert.match(JSON.stringify(features),/remarkable athlete/);assert.match(JSON.stringify(features),/explicit ruling/);assert.ok(walk(features).filter(v=>v.type).length<=40);
});
test('private panel refuses delivery if membership is revoked while projection is pending',async()=>{
 let member=true;
 const adapter=createHollowLanternAdapter({campaignId:'fixture',authorize:async()=>member,resolveActor:async()=> 'own',engine:{command:async()=>{},project:async()=>{member=false;return {revision:1,title:'private',summary:'secret possession',actions:[]};}}});
 await assert.rejects(adapter.panel({userId:'u',actorId:'own',tab:'inventory'}),/Access changed/);
});
