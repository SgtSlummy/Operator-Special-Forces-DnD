import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GameAi } from './service.mjs';
import { ObusTransport, loopback } from './obus.mjs';
const scope = { campaign: 'a', owner: 'p1', role: 'player' };
const job = { session: 'session1', requestId: 'r1', query: 'harbor', task: 'narration', evidence: { fact: 'The harbor is open.' }, sourceRevision: 4, exportable: true };
const caps = { contract: 'raph-obus-game-v1', campaign_rag: true, audience_filtering: true, provider_allowlist: true, codex_gate: true, no_tools: true, no_personal_memory: true, no_auto_memory: true };
function setup(t, transport) { const db = new DatabaseSync(':memory:'); t.after(() => db.close()); return new GameAi({ db, transport: { runtimeState: async () => structuredClone(runtime), ...transport }, authorize: scope => scope.role }); }
const answer = { text: 'The harbor is open.', model: 'fixture', routeId: 'route1', trace: [{ destination: 'local', provider: 'ollama' }], sources: [{ ref: 'scene1', revision: 4 }] };
const runtime = { contract: 'raph-obus-game-runtime-v1', requiredForRoute: true,
  bootEpoch: '11111111-1111-4111-8111-111111111111', generation: '22222222-2222-4222-8222-222222222222',
  sessionPolicyRevision: 3, leaseExpiresAtMs: Date.now() + 300_000,
  effectivePolicy: { enabled: true, mode: 'local-free', exportable: true, codex: false, tools: false, personalMemory: false, autoMemory: false }, queuedCount: 0, dispatchedCount: 0 };
const fence = { contract: runtime.contract, bootEpoch: runtime.bootEpoch, generation: runtime.generation, sessionPolicyRevision: runtime.sessionPolicyRevision };
const capturedRuntime = { ...fence, leaseExpiresAtMs: runtime.leaseExpiresAtMs };
function wav() {
  const bytes = Buffer.alloc(46); bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40); return bytes;
}
test('one Obus request owns generation; duplicate game requests share a receipt', async t => {
  const calls = []; const ai = setup(t, { generate: async request => { calls.push(request); return answer; } });
  const [a, b] = await Promise.all([ai.run(scope, job), ai.run(scope, job)]);
  assert.deepEqual(a, b); assert.equal(calls.length, 1); assert.equal(a.provider, 'obus'); assert.equal(a.routeId, 'route1');
  assert.deepEqual(calls[0].scope, scope); assert.equal(calls[0].policy.codex, false); assert.equal(calls[0].policy.namespace, 'a');
  assert.equal(calls[0].model, undefined); assert.equal(calls[0].evidence.sources, undefined);
  await assert.rejects(ai.run(scope, { ...job, query: 'different' }), /already used/);
});
test('queued requests read current Obus policy; recreating an app consumer cannot reset Obus authority', async t => {
  const calls = [], authority = structuredClone(runtime); let release;
  authority.effectivePolicy.codex = true;
  const transport = { runtimeState: async () => structuredClone(authority), generate: async r => { calls.push(r); if(calls.length === 1) await new Promise(resolve => { release = resolve; }); return answer; } };
  const ai = setup(t, transport);
  const first = ai.run(scope, { ...job, task: 'final' }); await new Promise(r => setTimeout(r, 0));
  const second = ai.run(scope, { ...job, requestId: 'r2', task: 'final' });
  authority.effectivePolicy.codex = false; authority.sessionPolicyRevision++; release();
  await Promise.all([first, second]); assert.equal(calls[0].policy.codex, true); assert.equal(calls[1].policy.codex, false);
  authority.effectivePolicy.codex = true;
  const otherConsumer = new GameAi({ db: ai.db, transport, authorize: scope => scope.role });
  assert.equal((await otherConsumer.policy('a', job.session)).codex, true);
  assert.equal((await ai.policy('a', job.session)).generation, authority.generation);
  assert.equal(ai.db.prepare("SELECT name FROM sqlite_master WHERE name='ai_policy'").get(), undefined);
});
test('Obus failure never invokes another model or local router', async t => {
  let calls = 0; const ai = setup(t, { generate: async () => { calls++; throw Error('Obus offline'); } });
  const r = await ai.run(scope, job); assert.equal(calls, 1); assert.equal(r.status, 'fallback'); assert.equal(r.provider, 'deterministic');
});
test('all network calls remain at Obus and carry explicit campaign policy', async () => {
  const urls = [], payloads = [];
  const transport = new ObusTransport({ serviceToken: 'a'.repeat(64), fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(options.headers['X-Obus-Game-Token'], 'a'.repeat(64));
    if(url.endsWith('/capabilities')) return Response.json(caps);
    if(url.includes('/api/game/runtime?')) return Response.json(runtime);
    payloads.push(JSON.parse(options.body)); return Response.json(answer);
  } });
  const r = await transport.generate({ instructions: 'Narrate.', evidence: job.evidence, scope, task: job.task, session: job.session, requestId: job.requestId, policy: { mode: 'local-free', codex: false, exportable: false } });
  assert.equal(r.provider, 'obus'); assert.deepEqual(urls, ['http://127.0.0.1:38175/api/game/capabilities', 'http://127.0.0.1:38175/api/game/runtime?campaign=a&session=session1', 'http://127.0.0.1:38175/api/game/route', 'http://127.0.0.1:38175/api/game/runtime?campaign=a&session=session1']);
  assert.deepEqual(payloads[0].runtime, fence);
  assert.equal(payloads[0].policy.personal_memory, false); assert.equal(payloads[0].policy.auto_memory, false); assert.equal(payloads[0].policy.tools, false); assert.equal(payloads[0].model, undefined);
});
test('no private request reaches an Obus endpoint without scoped capabilities', async () => {
  let calls=0; const t=new ObusTransport({ serviceToken: 'a'.repeat(64), fetchImpl:async()=>{ calls++; return Response.json({contract:'old'}); } });
  await assert.rejects(t.generate({scope,policy:{}}),/campaign-scoped/); assert.equal(calls,1);
});
test('response validation rejects hidden Codex stages, paid fallback and export violations', async () => {
  for(const stage of [{destination:'codex'},{destination:'free',cost:'paid'},{destination:'unknown'}]) {
    const t=new ObusTransport({ serviceToken: 'a'.repeat(64),fetchImpl:async url=>Response.json(url.endsWith('/capabilities') ? caps : url.includes('/api/game/runtime?') ? runtime : {...answer,trace:[stage]})});
    await assert.rejects(t.generate({scope,session:job.session,requestId:job.requestId,policy:{mode:'local-free',codex:false,exportable:true}}),/violated/);
  }
  const t=new ObusTransport({ serviceToken: 'a'.repeat(64),fetchImpl:async url=>Response.json(url.endsWith('/capabilities') ? caps : url.includes('/api/game/runtime?') ? runtime : {...answer,trace:[{destination:'free',cost:'zero'}]})});
  await assert.rejects(t.generate({scope,session:job.session,requestId:job.requestId,policy:{mode:'local-free',codex:false,exportable:false}}),/violated/);
});
test('speech goes only through Obus local transcription',async()=>{
  let called; const urls = []; const t=new ObusTransport({ serviceToken: 'a'.repeat(64),fetchImpl:async(url,options)=>{
    urls.push(url); if (url.includes('/api/game/runtime?')) return Response.json(runtime);
    called={url,body:JSON.parse(options.body)}; return Response.json({status:'completed',result:{kind:'transcript',text:'hello',engine:'faster-whisper',model:'tiny',trace:[{destination:'local'}]},receipt:{requestId:job.requestId}});
  }});
  assert.equal(await t.transcribe(wav(), {scope,session:job.session,requestId:job.requestId,capturedRuntime,capturedConsentEpoch:0}),'hello');
  assert.ok(called.url.endsWith('/api/voice/transcribe')); assert.equal(called.body.contract,'raph-obus-game-stt-v1'); assert.equal(called.body.mime_type,'audio/wav');
  assert.deepEqual(called.body.scope,scope); assert.deepEqual(called.body.runtime,fence); assert.equal(called.body.session,job.session); assert.equal(called.body.requestId,job.requestId);
  assert.equal(called.body.capturedConsentEpoch,undefined); assert.equal(called.body.runtime.leaseExpiresAtMs,undefined); assert.equal(urls.length,3);
  assert.throws(()=>loopback('https://example.com')); assert.throws(()=>loopback('http://user:pass@localhost'));
});
