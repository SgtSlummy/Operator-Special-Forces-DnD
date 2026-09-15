import { randomUUID } from 'node:crypto';
import { ObusTransport } from '../ai/obus.mjs';
import { createGameService, presentProjection } from './service.mjs';

const policy = campaign => ({ mode: 'local', codex: false, exportable: false, escalationEligible: false, namespace: campaign, tools: false, personal_memory: false, auto_memory: false });
// The local reasoning model spends this allowance on reasoning and final text.
// Keep both bounded while allowing it to actually return an actionable answer.
export const PARTY_MAX_TOKENS = 2000;
const failure = code => Object.assign(new Error(code), {code});
function failureCode(error) {
  const http = /^AI service unavailable \((\d{3})\)\.$/.exec(error?.message ?? '');
  if(http)return 'AI_HTTP_'+http[1];
  const known={
    'Obus requires an enabled, current game-host generation.':'AI_GENERATION_UNAVAILABLE',
    'The game-host authority changed. Capture new input after reconnecting.':'AI_GENERATION_CHANGED',
    'Obus returned no verifiable route trace.':'AI_TRACE_MISSING',
    'Obus route violated the campaign provider policy.':'AI_POLICY_MISMATCH',
    'Obus returned an invalid game runtime state.':'AI_RUNTIME_INVALID',
  };
  return known[error?.message]??String(error?.code??error?.name??'unknown').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
}
export const hasPendingRuling = p => (p.pendingActions ?? []).some(action => action.kind !== 'reaction');
const mayRespond = (p, actorId) => !hasPendingRuling(p) && (!(p.pendingActions ?? []).some(a => a.kind === 'reaction') || p.pendingActions.some(a => a.kind === 'reaction' && a.reactors?.includes(actorId)));
const selectActions = actions => {
  const counts = new Map();
  return actions.filter(a => { const n = counts.get(a.group) ?? 0; counts.set(a.group, n + 1); return n < 4; }).slice(0, 48);
};
export function playerEvidence(p) {
  if(p?.audience!=='private'||!p.characterId)throw failure('AI_PRIVATE_VIEW_REQUIRED');
  const view = presentProjection(p), offered = selectActions(view.actions);
  const own=(p.characters??[]).find(c=>c.characterId===p.characterId);
  if(!own)throw failure('AI_PRIVATE_VIEW_REQUIRED');
  const position=v=>Number.isInteger(v?.x)&&Number.isInteger(v?.y)?{x:v.x,y:v.y}:undefined;
  const text=v=>typeof v==='string'?v:undefined;
  const visible=new Set((view.map?.cells??[]).filter(c=>c.visibility==='visible').map(c=>c.x+','+c.y));
  const mission={};for(const key of ['briefed','technicianRescued','signalRestored','complete','canScout'])if(typeof p.mission?.[key]==='boolean')mission[key]=p.mission[key];
  if(typeof p.mission?.convoyOutcome==='string')mission.convoyOutcome=p.mission.convoyOutcome;
  const evidence={question:'',campaignPremise:'Operation Hollow Lantern: investigate a missing convoy and a failing coastal signal network.',
    character:{...view.actor,position:position(own.position),resources:structuredClone(own.resources??{})},
    turn:{phase:p.phase,round:p.round,yourTurn:p.phase!=='combat'||p.activeActorId===p.characterId},scene:{title:view.title,summary:view.summary},
    discoveries:(p.discoveries??[]).filter(v=>typeof v==='string'),mission,
    map:view.map?{width:view.map.width,height:view.map.height,scaleFeet:view.map.scaleFeet,terrainRulesVersion:view.map.terrainRulesVersion??0,cellFields:['x','y','terrain','visibility','cover','obscurement','creaturesVisible'],cells:(view.map.cells??[]).filter(c=>['visible','remembered'].includes(c.visibility)).map(c=>[c.x,c.y,c.terrain,c.visibility,c.cover??'none',c.obscurement??'none',c.creaturesVisible??true]),tokens:view.map.tokens,
      objects:(view.map.objects??[]).filter(o=>visible.has(o.x+','+o.y)).map(o=>({id:text(o.id),label:text(o.label),kind:text(o.kind),position:position(o)}))}:null,
    journal:view.journal.slice(-8).map(t=>String(t).slice(0,800)),
    availableActions:offered.map(a=>({id:a.id,label:a.label,description:a.description,fields:a.fields}))};
  // Preserve persistent knowledge and actionable objects before optional prose.
  while(Buffer.byteLength(JSON.stringify(evidence))>23000&&evidence.journal.length)evidence.journal.shift();
  if(Buffer.byteLength(JSON.stringify(evidence))>23000)throw failure('AI_EVIDENCE_TOO_LARGE');
  return {evidence,offered};
}

/** start() merely enables this controller; it does not open decisions or schedule a loop.
 * onDecisionOpened({opportunityId,maxActions=3,timeoutMs=90000,maxTokens=2000}) performs
 * one bounded opportunity. getGate() must query authoritative DM decision state and return
 * {decisionOpen,hasPendingRulings}. authorizeAI(scope) is a trusted logical-seat check;
 * engine projections additionally must show that actor's exact ownerId.
 * provisionSession({campaign,owner,actorId,session}) creates/renews only that Obus session.
 * onIntent is DM-private; onCommit receives authoritative receipts, never proposed outcomes.
 */
export function createParty({ client, campaignId, actors, authorizeAI, getGate, provisionSession,
  revokeSession = async () => {}, transport = new ObusTransport({ url: 'http://127.0.0.1:38176' }), onIntent = () => {}, onCommit = () => {} }) {
  if (client?.campaignId !== campaignId || !Array.isArray(actors) || actors.length !== 3 || new Set(actors.map(a => a.actorId)).size !== 3 || new Set(actors.map(a => a.ownerId)).size !== 3
    || actors.some(a => !['ai-fighter','ai-rogue','ai-cleric'].includes(a.ownerId)) || ![authorizeAI,getGate,provisionSession].every(f => typeof f === 'function')) throw new Error('Three distinct logical AI seats and authoritative gates are required.');
  const seats = actors.map(a => ({ actorId: a.actorId, ownerId: a.ownerId, session: `player-${a.actorId}-${randomUUID().slice(0, 8)}`, retired:false, retiring:null }));
  const service = createGameService({ client, authorize: authorizeAI });
  let enabled = false, running = false, controller;
  const privateIntents = new Map();
  const opportunities = new Set();
  async function gate() { const state = await getGate(); return enabled && !controller?.signal.aborted && state.decisionOpen === true && state.hasPendingRulings !== true; }
  async function retire(seat){
    privateIntents.delete(seat.actorId);
    if(seat.retiring)return seat.retiring;if(seat.retired)return;
    seat.retiring=(async()=>{await revokeSession({campaign:campaignId,owner:seat.ownerId,actorId:seat.actorId,session:seat.session});seat.session=`player-${seat.actorId}-${randomUUID().slice(0,8)}`;seat.retired=true;})();
    try{await seat.retiring;}finally{seat.retiring=null;}
  }
  async function seatAllowed(seat){const state=await getGate();
    if(state.eligibleActorIds!==undefined&&(!Array.isArray(state.eligibleActorIds)||state.eligibleActorIds.some(id=>!seats.some(s=>s.actorId===id))))throw new Error('Invalid authoritative AI roster');
    if(state.eligibleActorIds!==undefined&&!state.eligibleActorIds.includes(seat.actorId)){await retire(seat);return false;}
    if(seat.retiring)await seat.retiring;seat.retired=false;return true;
  }
  async function projection(seat) {
    const scope = { campaignId, userId: seat.ownerId, actorId: seat.actorId, audience: 'player' };
    if (!await authorizeAI(scope)) throw new Error('AI seat authorization changed');
    const p = await client.project({ ownerId: seat.ownerId, actorId: seat.actorId, audience: 'private', mapLevel: 'tactical' });
    if (p.audience !== 'private' || p.characterId !== seat.actorId || p.campaignId !== campaignId || p.characters?.find(c => c.characterId === seat.actorId)?.ownerId !== seat.ownerId) throw new Error('AI character ownership mismatch');
    return p;
  }
  async function plan(seat, maxTokens, opportunityId) {
    if (!await gate()||!await seatAllowed(seat)) return null;
    const p = await projection(seat);
    if (!p.decisionOpen || !mayRespond(p, seat.actorId)) return null;
    const { evidence, offered } = playerEvidence(p);
    if (!offered.length || Buffer.byteLength(JSON.stringify(evidence)) > 23000) return null;
    await provisionSession({ campaign: campaignId, owner: seat.ownerId, actorId: seat.actorId, session: seat.session });
    const result = await transport.generate({ scope: { campaign: campaignId, owner: seat.ownerId, role: 'player' }, session: seat.session, requestId: randomUUID(), task: 'intent',
      instructions: 'You control only this character. Use only this private view and its offered actions. Other characters communicate through explicit in-game actions. Choose one offered action, or wait when a DM ruling is needed. Reply JSON only: {"actionId":string|null,"fields":{},"reason":string}. Field values must be strings. Never invent a rule outcome, hidden information, or an action ID.',
      evidence, policy: policy(campaignId), maxTokens, signal: controller.signal });
    if (result.sources?.length || !result.trace?.length || result.trace.some(t => t.destination !== 'local')) throw failure('AI_ROUTE_NOT_ISOLATED');
    let selected; try { selected = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw failure('AI_INTENT_INVALID_JSON'); }
    if (selected.actionId === null) return null;
    const action = offered.find(a => a.id === selected.actionId);
    if (!action || !selected.fields || typeof selected.fields !== 'object' || Array.isArray(selected.fields) || Object.keys(selected.fields).some(k => !action.fields.some(f => f.id === k)) || Object.values(selected.fields).some(v => typeof v !== 'string')) throw failure('AI_INTENT_UNAVAILABLE');
    if (!await gate()||!await seatAllowed(seat)) return null;
    const intent = { actorId: seat.actorId, ownerId: seat.ownerId, revision: p.revision, opportunityId, actionId: action.id, fields: selected.fields, reason: String(selected.reason ?? '').slice(0, 500), status: 'proposed' };
    privateIntents.set(seat.actorId, intent); await onIntent(structuredClone(intent));
    return intent;
  }
  return Object.freeze({
    async syncOwnership(){await Promise.all(seats.map(seatAllowed));},
    start() { enabled = true; },
    close() { enabled = false; controller?.abort(); privateIntents.clear(); },
    getPrivateIntents() { return structuredClone([...privateIntents.values()]); },
    async onDecisionOpened({ opportunityId = randomUUID(), maxActions = 3, timeoutMs = 90000, maxTokens = PARTY_MAX_TOKENS } = {}) {
      if (!enabled || running) return { status: running ? 'busy' : 'closed', committed: [] };
      if (opportunities.has(opportunityId)) return { status: 'already-handled', committed: [] };
      if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 3 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 || !Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > PARTY_MAX_TOKENS) throw new Error('Party opportunity exceeds its bounds.');
      running = true; controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const committed = [], failures = [];
      try {
        if (!await gate()) return { status: 'paused', committed };
        opportunities.add(opportunityId);
        if (opportunities.size > 64) opportunities.delete(opportunities.values().next().value);
        await Promise.all(seats.map(seatAllowed));
        const plans = await Promise.allSettled(seats.map(seat => plan(seat, maxTokens, opportunityId)));
        for (let i = 0; i < seats.length && committed.length < maxActions; i++) {
          if (!await gate()) break;
          if(!await seatAllowed(seats[i]))continue;
          if (plans[i].status === 'rejected') { failures.push({ actorId: seats[i].actorId, reason: 'planning-failed', code: failureCode(plans[i].reason) }); break; }
          let intent = plans[i].value;
          if (!intent) continue;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (!await gate()||!await seatAllowed(seats[i])) break;
            const current = await projection(seats[i]);
            if (!current.decisionOpen || !mayRespond(current, seats[i].actorId)) break;
            if (current.revision !== intent.revision) { if (attempt) break; intent = await plan(seats[i], maxTokens, opportunityId); if (!intent) break; continue; }
            try {
              const receipt = await service.command({ campaignId, userId: seats[i].ownerId, actorId: seats[i].actorId, audience: 'player', expectedRevision: intent.revision, commandId: randomUUID(), action: intent.actionId, payload: intent.fields });
              committed.push({ actorId: seats[i].actorId, receipt }); privateIntents.set(seats[i].actorId, { ...intent, status: 'committed' }); await onCommit({ actorId: seats[i].actorId, receipt }); break;
            } catch (error) {
              if (error.code === 'STALE_REVISION' && !attempt) { intent = await plan(seats[i], maxTokens, opportunityId); if (!intent) break; continue; }
              failures.push({ actorId: seats[i].actorId, reason: 'command-not-confirmed', code:failureCode(error) }); break;
            }
          }
          if (failures.length) break;
        }
        return { status: controller.signal.aborted ? 'timed-out' : failures.length ? 'stopped' : 'complete', committed, failures };
      } finally { clearTimeout(timer); running = false; }
    },
  });
}
