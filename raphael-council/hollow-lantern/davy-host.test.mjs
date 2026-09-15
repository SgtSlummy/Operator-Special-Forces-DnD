import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDavyHost } from './davy-host.mjs';
import {createPresentationState} from './presentation-state.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ids = { guildId: '111111111111111111', channelId: '222222222222222222', applicationId: '333333333333333333', gmUserId: '444444444444444444', player: '555555555555555555' };
async function persistentFixture(t){const root=await mkdtemp(join(tmpdir(),'hollow-host-state-'));t.after(()=>rm(root,{recursive:true,force:true}));return createPresentationState({file:join(root,'state.json'),campaignId:'operation-hollow-lantern',...ids});}
function setup(options={}) {
  const discord = new EventEmitter(), calls = { members: [], projections: [], commands: [], posts: [], sends: [], edits: [] };
  let memberPresent = true, revision = 1, registry = [{ id: 'music', name: 'play', type: 1 }], gate, editFailure = false;
  const liveOwners={human:ids.player,mara:'ai-fighter'};
  const lobby = { id: 'lobby', async edit(payload) { calls.edits.push(payload); if (editFailure) { editFailure = false; throw new Error('Discord temporarily unavailable'); } return lobby; } };
  discord.guilds = { fetch: async () => ({ members: { fetch: async options => { calls.members.push(options); if (!memberPresent) throw new Error('revoked'); return { id: options.user, user: { bot: false } }; } } }) };
  discord.channels = { fetch: async () => ({ guildId: ids.guildId, isTextBased: () => true, send: async payload => { calls.sends.push(payload); return lobby; } }) };
  discord.rest = { get: async () => registry, post: async (route, data) => { calls.posts.push({ route, ...data }); return { id: 'registered', ...data.body }; } };
  const engine = { campaignId: 'operation-hollow-lantern', channelId: ids.channelId,
    async project(scope) {
      calls.projections.push(scope); const snapshot = revision;
      if (gate) { const wait = gate; gate = null; await wait; }
      const characters=scope.audience==='public'?[]:Object.entries(liveOwners).filter(([id])=>scope.audience==='gm'||id===scope.actorId).map(([characterId,ownerId])=>({characterId,ownerId,characterType:'player',displayName:characterId}));
      return { projectionVersion: 2, campaignId: engine.campaignId, revision: snapshot, audience: scope.audience, characterId: scope.actorId, currentSceneId: 'briefing', phase: 'exploration', decisionOpen: false, characters, publicEvents: [{ text: `Public revision ${snapshot}` }] };
    },
    async command(command) { calls.commands.push(command); return { revision: ++revision, commandId: command.commandId }; } };
  const config = { enabled: true, ...ids, campaignId: engine.campaignId, characterOwners: { mara: 'ai-fighter', kestrel: 'ai-rogue', ash: 'ai-cleric', human: ids.player } };
  const host = createDavyHost({ discordClient: discord, config, engineClient: engine,...options });
  return { host, discord, calls, config, liveOwners, setMember: value => memberPresent = value, setRevision: value => revision = value, setRegistry: value => registry = value, gate: value => gate = value, failNextEdit: () => editFailure = true };
}
test('disabled composition is inert; close removes only its listener', () => {
  assert.equal(createDavyHost({ config: { enabled: false } }).enabled, false);
  const { host, discord, calls } = setup(); const music = () => {}; discord.on('interactionCreate', music);
  assert.equal(calls.members.length, 0); assert.equal(calls.projections.length, 0); host.close();
  assert.deepEqual(discord.listeners('interactionCreate'), [music]);
});
test('duplicate mounting refuses a second handler for the same command', () => {
  const { host, discord, config } = setup();
  assert.throws(() => createDavyHost({ discordClient: discord, config }), /already mounted/);
  assert.equal(discord.listenerCount('interactionCreate'), 1); host.close();
});
test('registration is additive and refuses name conflicts without overwriting music', async () => {
  const { host, calls, setRegistry } = setup(); await host.registerCommand();
  assert.equal(calls.posts.length, 1); assert.equal(calls.posts[0].body.name, 'hollow-lantern'); assert.match(calls.posts[0].route, /\/guilds\//);
  setRegistry([{ id: 'existing', name: 'hollow-lantern', type: 1 }, { name: 'play' }]);
  await assert.rejects(host.registerCommand(), /already exists/); assert.equal(calls.posts.length, 1); host.close();
});
test('every authorization fetches current membership and logical AI owners are never Discord seats', async () => {
  const { host, calls, setMember, config } = setup();
  assert.equal(await host.authorize({ campaignId: config.campaignId, userId: ids.player, actorId: 'human', audience: 'player' }), true);
  assert.equal(await host.authorize({ campaignId: config.campaignId, userId: ids.player, actorId: 'mara', audience: 'player' }), false);
  assert.equal(await host.authorize({ campaignId: config.campaignId, userId: 'ai-fighter', actorId: 'mara', audience: 'player' }), false);
  assert.deepEqual(await host.resolveScope({ userId: ids.gmUserId }), { audience: 'gm' });
  setMember(false); assert.equal(await host.authorize({ campaignId: config.campaignId, userId: ids.player, actorId: 'human', audience: 'player' }), false);
  assert.ok(calls.members.every(m => m.force && m.cache === false)); host.close();
});
test('engine ownership changes take effect without restarting the Discord host',async()=>{const {host,liveOwners,config}=setup();liveOwners.human='666666666666666666';assert.equal(await host.authorize({campaignId:config.campaignId,userId:ids.player,actorId:'human',audience:'player'}),false);liveOwners.mara=ids.player;assert.deepEqual(await host.resolveScope({userId:ids.player}),{actorId:'mara',audience:'player'});assert.equal(await host.authorize({campaignId:config.campaignId,userId:ids.player,actorId:'mara',audience:'player'}),true);host.close();});
test('persistent Open Table control mints a fresh link only when its authorized viewer clicks',async()=>{
 const links=[],replies=[];const {host,setMember}=setup({webLink:async scope=>{links.push(scope);return 'http://127.0.0.1:18000/#one-use-code';}});
 const payload=await host.openPanel({userId:ids.gmUserId,audience:'gm'}),button=payload.components.at(-1).components[0];
 assert.equal(button.label,'Open Table');assert.equal(links.length,0);assert.equal(button.url,undefined);
 const interaction={customId:button.custom_id,guildId:ids.guildId,applicationId:ids.applicationId,user:{id:ids.gmUserId},reply:async p=>replies.push(p),deferReply:async p=>replies.push(p),editReply:async p=>replies.push(p)};
 await host.handleInteraction({...interaction,user:{id:ids.player}});assert.equal(links.length,0);
 await host.handleInteraction(interaction);assert.equal(links.length,1);assert.equal(replies.at(-1).components[0].components[0].url,'http://127.0.0.1:18000/#one-use-code');
 await host.handleInteraction(interaction);assert.equal(links.length,2);
 setMember(false);await host.handleInteraction(interaction);assert.equal(links.length,2);
 await assert.rejects(host.openPanel({userId:ids.gmUserId,audience:'gm'}));host.close();
});

test('restart adopts verified command and lobby IDs without duplicate sends',async t=>{
 const presentationState=await persistentFixture(t),f=setup({presentationState});
 const command={id:'666666666666666666',name:'hollow-lantern',type:1,application_id:ids.applicationId,guild_id:ids.guildId};
 f.discord.rest.post=async()=>{f.calls.posts.push(command);f.setRegistry([command]);return command;};
 const lobby={id:'777777777777777777',channelId:ids.channelId,author:{id:ids.applicationId},edit:async payload=>{f.calls.edits.push(payload);return lobby;}};
 f.discord.channels.fetch=async()=>({guildId:ids.guildId,isTextBased:()=>true,messages:{fetch:async()=>lobby},send:async payload=>{f.calls.sends.push(payload);return lobby;}});
 await Promise.all([f.host.registerCommand(),f.host.registerCommand()]);
 await f.host.publishLobby({requestedBy:ids.gmUserId});f.host.close();
 const restarted=createDavyHost({discordClient:f.discord,config:f.config,engineClient:f.host.engine,presentationState});
 await restarted.registerCommand();await restarted.publishLobby({requestedBy:ids.gmUserId});
 assert.equal(f.calls.posts.length,1);assert.equal(f.calls.sends.length,1);assert.equal(f.calls.edits.length,1);restarted.close();
});
test('ambiguous Discord POST remains blocked across restart without retry',async t=>{
 const presentationState=await persistentFixture(t),f=setup({presentationState});let attempts=0;
 f.discord.rest.post=async()=>{attempts++;throw new Error('socket closed after write');};
 await assert.rejects(f.host.registerCommand());f.host.close();
 const restarted=createDavyHost({discordClient:f.discord,config:f.config,engineClient:f.host.engine,presentationState});
 await assert.rejects(restarted.registerCommand(),/recovery/);assert.equal(attempts,1);restarted.close();
});
test('ambiguous public send is not retried and recovered foreign owner is rejected',async t=>{
 const presentationState=await persistentFixture(t),f=setup({presentationState});let attempts=0;
 f.discord.channels.fetch=async()=>({guildId:ids.guildId,isTextBased:()=>true,send:async()=>{attempts++;throw new Error('unknown delivery');}});
 await assert.rejects(f.host.publishLobby({requestedBy:ids.gmUserId}));
 await assert.rejects(f.host.publishLobby({requestedBy:ids.gmUserId}),/recovery/);assert.equal(attempts,1);f.host.close();
});
test('public lobby requires DM and uses only public engine projection', async () => {
  const { host, calls } = setup();
  await assert.rejects(host.publishLobby({ requestedBy: ids.player }), /Only the current DM/);
  await host.publishLobby({ requestedBy: ids.gmUserId }); assert.equal(calls.sends.length, 1);
  assert.ok(calls.projections.every(p => p.audience === 'public' && p.ownerId === ids.gmUserId));
  assert.doesNotMatch(JSON.stringify(calls.sends), /character-map|inventory|pendingActions/); host.close();
});
test('only committed receipt triggers public refresh and duplicate revisions are suppressed', async () => {
  const { host, calls, config } = setup(); await host.publishLobby({ requestedBy: ids.gmUserId });
  await host.service.command({ campaignId: config.campaignId, userId: ids.gmUserId, audience: 'gm', expectedRevision: 1, commandId: 'checkpoint-one', action: 'checkpoint', payload: {} });
  assert.equal(calls.commands.length, 1); assert.equal(calls.edits.length, 1);
  assert.equal(await host.refreshPublic({ committedRevision: 2 }), false); assert.equal(calls.edits.length, 1);
  await assert.rejects(host.service.command({ campaignId: config.campaignId, userId: ids.gmUserId, audience: 'gm', expectedRevision: 1, commandId: 'stale', action: 'checkpoint', payload: {} }), /scene changed/);
  assert.equal(calls.edits.length, 1); host.close();
});
test('delayed old render cannot replace newer committed public output', async () => {
  const { host, calls, setRevision, gate } = setup(); await host.publishLobby({ requestedBy: ids.gmUserId });
  let release; gate(new Promise(resolve => release = resolve)); setRevision(2);
  const old = host.refreshPublic({ committedRevision: 2 });
  // Advance until the old projection has entered its controllable wait.
  while (calls.projections.length < 2) await new Promise(resolve => setImmediate(resolve));
  setRevision(3); await host.refreshPublic({ committedRevision: 3 }); release(); await old;
  assert.equal(calls.edits.length, 1); assert.match(JSON.stringify(calls.edits[0]), /Public revision 3/); host.close();
});
test('slash command opens GM panel and leaves unrelated music interactions untouched', async () => {
  const { host, calls } = setup(); const replies = [];
  const i = { guildId: ids.guildId, applicationId: ids.applicationId, commandName: 'hollow-lantern', isChatInputCommand: () => true, user: { id: ids.gmUserId }, options: { getBoolean: () => false }, deferReply: async payload => replies.push(payload), editReply: async payload => replies.push(payload) };
  assert.equal(await host.handleInteraction(i), true); assert.equal(replies[0].flags, 64); assert.equal(calls.projections.at(-1).audience, 'gm');
  assert.equal(await host.handleInteraction({ ...i, commandName: 'play' }), false); host.close();
});

test('shared service emits committed events and observer failures cannot reject a receipt',async()=>{
 const errors=[],{host,config}=setup({onError:error=>errors.push(error.code)});let seen;
 const stop=host.onCommitted(event=>{seen=event;throw new Error('observer failure');});
 const receipt=await host.service.command({campaignId:config.campaignId,userId:ids.gmUserId,audience:'gm',expectedRevision:1,commandId:'hook-checkpoint',action:'checkpoint',payload:{}});
 assert.equal(seen.receipt.revision,receipt.revision);assert.equal(seen.input.action,'checkpoint');assert.ok(errors.includes('COMMIT_OBSERVER_FAILED'));assert.equal(host.engine.campaignId,config.campaignId);stop();host.close();
});

test('failed public rendering can retry its committed revision without duplicate commands or observers',async()=>{
 const errors=[],{host,calls,config}=setup({onError:e=>errors.push(e.code)});await host.publishLobby({requestedBy:ids.gmUserId});
 const original=host.engine.project;let fail=true,observed=0;host.onCommitted(()=>observed++);
 host.engine.project=async scope=>{if(scope.audience==='public'&&fail){fail=false;throw new Error('Projection unavailable');}return original(scope);};
 const receipt=await host.service.command({campaignId:config.campaignId,userId:ids.gmUserId,audience:'gm',expectedRevision:1,commandId:'render-recovery',action:'checkpoint',payload:{}});
 assert.equal(receipt.revision,2);assert.equal(observed,1);assert.ok(errors.includes('PUBLIC_REFRESH_FAILED'));assert.equal(calls.edits.length,0);
 assert.equal(await host.refreshPublic({committedRevision:receipt.revision}),true);
 assert.equal(await host.refreshPublic({committedRevision:receipt.revision}),false);
 assert.equal(calls.commands.length,1);assert.equal(observed,1);assert.equal(calls.edits.length,1);host.close();
});

test('failed Discord edit releases only presentation reservation and supports same-revision retry',async()=>{
 const {host,calls,setRevision,failNextEdit}=setup();await host.publishLobby({requestedBy:ids.gmUserId});setRevision(2);failNextEdit();
 await assert.rejects(host.refreshPublic({committedRevision:2}),/temporarily unavailable/);
 assert.equal(await host.refreshPublic({committedRevision:2}),true);assert.equal(calls.edits.length,2);assert.equal(calls.commands.length,0);
 assert.equal(await host.refreshPublic({committedRevision:2}),false);host.close();
});

test('approved presentation refresh can update same revision but refuses stale art revision',async()=>{
 const {host,calls,setRevision}=setup();await host.publishLobby({requestedBy:ids.gmUserId});let observed=0;host.onCommitted(()=>observed++);
 assert.equal(await host.refreshPublic({committedRevision:1,forcePresentation:true}),true);assert.equal(calls.edits.length,1);
 setRevision(2);assert.equal(await host.refreshPublic({committedRevision:1,forcePresentation:true}),false);assert.equal(calls.edits.length,1);
 assert.equal(calls.commands.length,0);assert.equal(observed,0);host.close();
});
test('revocation during asynchronous panel extras prevents private delivery',async()=>{
 let revoke;const f=setup({panelExtras:async()=>{revoke();return [];}});revoke=()=>f.setMember(false);
 await assert.rejects(f.host.openPanel({userId:ids.gmUserId,audience:'gm'}),/access changed/i);f.host.close();
});

test('journal public cards do not repeat ordinary commit observers and preserve the original decision identity',async()=>{
 const recorded=[],flushed=[];const publicFeed={record:async value=>recorded.push(value),flush:async value=>{flushed.push(value);return {cursor:2};}};
 const f=setup({publicFeed});await f.host.publishLobby({requestedBy:ids.gmUserId});const seen=[];f.host.onCommitted(e=>seen.push(e));
 const receipt=await f.host.service.command({campaignId:f.config.campaignId,userId:ids.gmUserId,audience:'gm',expectedRevision:1,commandId:'journal-checkpoint',action:'checkpoint',payload:{}});
 const projection={projectionVersion:2,audience:'public',campaignId:f.config.campaignId,revision:2,characters:[],publicEvents:[{revision:2,text:'A public checkpoint.'}]};
 const entry={revision:2,commandId:receipt.commandId,ownerId:ids.gmUserId,actorId:'',type:'checkpoint',receipt:{...receipt,campaignId:f.config.campaignId},publicProjection:projection};
 await f.host.acceptCommittedEvent(entry);assert.equal(seen.length,1);assert.equal(recorded[0].projection,projection);assert.equal(flushed.length,1);
 await assert.rejects(f.host.acceptCommittedEvent({...entry,publicProjection:{...projection,audience:'gm'}}),/scope mismatch/);
 f.setRevision(3);await f.host.acceptCommittedEvent({...entry,revision:3,commandId:'activity-decision',type:'gm_decision',receipt:{campaignId:f.config.campaignId,revision:3,commandId:'activity-decision'},publicProjection:{...projection,revision:3}});
 assert.equal(seen.length,2);assert.equal(seen[1].scope.action,'decision');assert.equal(seen[1].receipt.commandId,'activity-decision');assert.ok(!('publicProjection' in seen[1]));f.host.close();
});

test('unresolved public delivery stops journal observers before another AI opportunity',async()=>{
 const f=setup({publicFeed:{record:async()=>{},flush:async()=>({blocked:'uncertain-send'})}});let observations=0;f.host.onCommitted(()=>observations++);
 const receipt={campaignId:f.config.campaignId,revision:2,commandId:'blocked-decision'};
 await assert.rejects(f.host.acceptCommittedEvent({revision:2,commandId:receipt.commandId,ownerId:ids.gmUserId,actorId:'',type:'gm_decision',receipt,publicProjection:{campaignId:f.config.campaignId,audience:'public',revision:2}}),/needs recovery/);
 assert.equal(observations,0);f.host.close();
});


test('host forwards the borrowed draft store only to authorized private player panels',async()=>{
 const reads=[];const draftStore={get:async scope=>{reads.push(scope);return null;},save:async()=>{},prepare:async()=>{},complete:async()=>{}};
 const f=setup({draftStore});try{
 await f.host.openPanel({userId:ids.player,actorId:'human',audience:'player'});
 assert.deepEqual(reads,[{campaignId:f.config.campaignId,userId:ids.player,actorId:'human',role:'player',visibility:'private'}]);
 await f.host.openPanel({userId:ids.gmUserId,audience:'gm'});assert.equal(reads.length,1);
 f.setMember(false);await assert.rejects(f.host.openPanel({userId:ids.player,actorId:'human',audience:'player'}));assert.equal(reads.length,1);
 }finally{await f.host.close();}
});

test('close drains accepted interactions and immediately refuses new work without closing borrowed drafts',async()=>{
 let entered,release,storeCloses=0;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const f=setup({draftStore:{get:async()=>null,save:async()=>{},prepare:async()=>{},complete:async()=>{},close:async()=>storeCloses++}});
 const interaction={guildId:'999999999999999999',applicationId:ids.applicationId,commandName:'hollow-lantern',isChatInputCommand:()=>true,reply:async()=>{entered();await gate;}};
 const pending=f.host.handleInteraction(interaction);await waiting;
 const closing=f.host.close();assert.equal(typeof closing?.then,'function');assert.equal(closing,f.host.close());
 let done=false;closing.then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,false);
 assert.equal(f.discord.listenerCount('interactionCreate'),0);assert.equal(await f.host.handleInteraction(interaction),false);
 release();assert.equal(await pending,true);await closing;assert.equal(storeCloses,0);
});

function findControls(payload){const all=[];const walk=n=>{if(n?.custom_id)all.push(n);for(const c of n?.components??[])walk(c);};walk(payload);return all;}
function entryInteraction(customId,userId=ids.player,overrides={}){const replies=[];return {customId,user:{id:userId},guildId:ids.guildId,channelId:ids.channelId,applicationId:ids.applicationId,message:{author:{id:ids.applicationId}},reply:async p=>replies.push(p),deferReply:async p=>replies.push(p),editReply:async p=>replies.push(p),replies,...overrides};}
test('public entry survives clock advance and host restart; unseated recap uses public data only',async()=>{
 const f=setup();await f.host.publishLobby({requestedBy:ids.gmUserId});const controls=findControls(f.calls.sends[0]);assert.equal(controls.length,3);const recap=controls.find(c=>c.label==='Session Recap').custom_id;f.host.close();
 const realNow=Date.now;Date.now=()=>realNow()+86400000;let next;try{next=setup();delete next.liveOwners.human;const i=entryInteraction(recap);await next.host.handleInteraction(i);assert.match(i.replies.at(-1).content,/Public revision/);assert.equal(next.calls.commands.length,0);assert.ok(next.calls.projections.every(p=>p.audience==='public'));}finally{Date.now=realNow;next?.host.close();}
});
test('persistent entry checks revoked members, origin application/channel and campaign binding',async()=>{
 const f=setup();try{await f.host.publishLobby({requestedBy:ids.gmUserId});const id=findControls(f.calls.sends[0])[1].custom_id;
 for(const overrides of [{channelId:'999999999999999999'},{message:{author:{id:ids.player}}},{applicationId:'999999999999999999'}]){const i=entryInteraction(id,ids.player,overrides);await f.host.handleInteraction(i);assert.ok(i.replies.length>=1);assert.equal(i.replies[0].flags,64);}
 const foreign=entryInteraction(id.replace(/entry:[^:]+:/,'entry:foreigncampaign:'));await f.host.handleInteraction(foreign);assert.match(foreign.replies.at(-1).content,/another campaign/);
 f.setMember(false);const revoked=entryInteraction(id);await f.host.handleInteraction(revoked);assert.match(revoked.replies.at(-1).content,/membership/);assert.equal(f.calls.commands.length,0);
 }finally{f.host.close();}
});
test('expired action opens only current seat with no command; copied known private control denied',async()=>{
 const f=setup();const old=await f.host.openPanel({userId:ids.gmUserId,audience:'gm'});const privateId=findControls(old).find(c=>c.type===2).custom_id;
 const copied=entryInteraction(privateId,ids.player);await f.host.handleInteraction(copied);assert.match(copied.replies.at(-1).content,/another player/);f.host.close();
 const next=setup();try{const expired=entryInteraction(privateId,ids.player);await next.host.handleInteraction(expired);assert.match(JSON.stringify(expired.replies.at(-1)),/old control expired/);assert.ok(!JSON.stringify(expired.replies.at(-1)).includes('DM tools'));assert.equal(next.calls.commands.length,0);
 delete next.liveOwners.human;const noSeat=entryInteraction(privateId,ids.player);await next.host.handleInteraction(noSeat);assert.match(noSeat.replies.at(-1).content,new RegExp(ids.gmUserId));assert.match(noSeat.replies.at(-1).content,/Switch/);assert.deepEqual(noSeat.replies.at(-1).allowedMentions,{parse:[]});assert.equal(next.calls.commands.length,0);
 }finally{next.host.close();}
});


test('permanent Join preserves enrollment callback after acknowledgement and current membership',async()=>{
 let entries=0;const f=setup({enrollmentEntry:async i=>{assert.equal(i.deferred,true);entries++;await i.editReply({content:'Enrollment'});}});
 try{await f.host.publishLobby({requestedBy:ids.gmUserId});const id=findControls(f.calls.sends[0]).find(c=>c.label==='Join').custom_id;const i=entryInteraction(id);i.deferReply=async()=>{i.deferred=true;};await f.host.handleInteraction(i);assert.equal(entries,1);assert.equal(f.calls.commands.length,0);
 f.setMember(false);await f.host.handleInteraction(entryInteraction(id));assert.equal(entries,1);assert.equal(f.calls.commands.length,0);
 }finally{f.host.close();}
});

test('expired real decision action select never commits or retains its GM authority',async()=>{
 const f=setup();const panel=await f.host.openPanel({userId:ids.gmUserId,audience:'gm'});
 const tools=findControls(panel).find(c=>c.placeholder==='DM tools'),pause=tools.options.find(o=>o.label==='Pause');const navigate=entryInteraction(tools.custom_id,ids.gmUserId,{values:[pause.value]});await f.host.handleInteraction(navigate);
 const actionSelect=findControls(navigate.replies.at(-1)).find(c=>c.options?.some(o=>o.label==='Open decisions'));assert.ok(actionSelect,'Actual mutating decision action was rendered');const decision=actionSelect.options.find(o=>o.label==='Open decisions');f.host.close();
 const next=setup();try{const expired=entryInteraction(actionSelect.custom_id,ids.player,{values:[decision.value]});await next.host.handleInteraction(expired);assert.equal(next.calls.commands.length,0);assert.match(JSON.stringify(expired.replies.at(-1)),/old control expired/);assert.ok(!JSON.stringify(expired.replies.at(-1)).includes('DM tools'));}finally{next.host.close();}
});
