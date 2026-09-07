import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// Private game adapter. Never call the general Obus route: it can retrieve
// unrelated memory or fan out to providers outside this campaign's policy.
export class AiError extends Error {}
const runtimeUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
function runtimeFence(value) {
  if (value?.contract !== 'raph-obus-game-runtime-v1' || !runtimeUuid(value.bootEpoch) || !runtimeUuid(value.generation) || !Number.isSafeInteger(value.sessionPolicyRevision) || value.sessionPolicyRevision < 0) throw new AiError('A captured game-host generation is required.');
  return Object.freeze({ contract: value.contract, bootEpoch: value.bootEpoch, generation: value.generation, sessionPolicyRevision: value.sessionPolicyRevision });
}
function sameRuntime(captured, current) {
  if (captured.contract !== current.contract || captured.bootEpoch !== current.bootEpoch || captured.generation !== current.generation || captured.sessionPolicyRevision !== current.sessionPolicyRevision) throw new AiError('The game-host authority changed. Capture new input after reconnecting.');
}
export function loopback(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new AiError('AI services must use a private loopback address.');
  return url.href.replace(/\/$/, '');
}
export async function boundedJson(response, limit = 1024 * 1024) {
  if (!response.ok) throw new AiError(`AI service unavailable (${response.status}).`);
  const reader = response.body?.getReader(); if (!reader) throw new AiError('Empty AI response.');
  const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new AiError('AI response exceeded its limit.'); chunks.push(value); }
  } catch (e) { await reader.cancel(); throw e; }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export class ObusTransport {
  constructor({ url = process.env.RAPHAEL_OBUS_URL || 'http://127.0.0.1:38175', fetchImpl = fetch, serviceToken = process.env.RAPHAEL_OBUS_GAME_TOKEN } = {}) {
    this.url = loopback(url); this.fetch = fetchImpl; this.serviceToken = serviceToken;
  }
  headers() {
    let value = this.serviceToken;
    if (!value) { try { value = readFileSync(process.env.RAPHAEL_OBUS_TOKEN_FILE || join(homedir(), '.occultbus', 'game-agent', 'service-token'), 'utf8').trim(); } catch { throw new AiError('Start the private Obus game agent first.'); } }
    if (!/^[a-f0-9]{64}$/.test(value)) throw new AiError('Invalid private Obus service credential.');
    return { 'Content-Type': 'application/json', 'X-Obus-Game-Token': value };
  }
  async status() { return this.capabilities(); }
  async capabilities() {
    const result = await boundedJson(await this.fetch(`${this.url}/api/game/capabilities`, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: this.headers() }));
    const required = ['campaign_rag', 'audience_filtering', 'provider_allowlist', 'codex_gate', 'no_tools', 'no_personal_memory', 'no_auto_memory'];
    if (result.contract !== 'raph-obus-game-v1' || !required.every(key => result[key] === true)) throw new AiError('Obus needs its campaign-scoped game-agent integration.');
    return result;
  }
  async runtimeState(scope, session) {
    if (!scope || typeof scope.campaign !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(scope.campaign) || typeof session !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(session)) throw new AiError('A valid campaign session is required for Obus.');
    const query = new URLSearchParams({ campaign: scope.campaign, session });
    const snapshot = await boundedJson(await this.fetch(`${this.url}/api/game/runtime?${query}`, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: this.headers() }));
    const policy = snapshot.effectivePolicy;
    const lease = snapshot.generation === null ? snapshot.leaseExpiresAtMs === null : runtimeUuid(snapshot.generation) && Number.isSafeInteger(snapshot.leaseExpiresAtMs) && snapshot.leaseExpiresAtMs >= 0;
    if (snapshot.contract !== 'raph-obus-game-runtime-v1' || snapshot.requiredForRoute !== true || !runtimeUuid(snapshot.bootEpoch) || !lease || !Number.isSafeInteger(snapshot.sessionPolicyRevision) || snapshot.sessionPolicyRevision < 0 || typeof policy?.enabled !== 'boolean' || !['local', 'local-free'].includes(policy.mode) || typeof policy.exportable !== 'boolean' || typeof policy.codex !== 'boolean' || policy.tools !== false || policy.personalMemory !== false || policy.autoMemory !== false || ['queuedCount', 'dispatchedCount'].some(key => snapshot[key] !== undefined && (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0))) {
      throw new AiError('Obus returned an invalid game runtime state.');
    }
    return Object.freeze({ contract: snapshot.contract, requiredForRoute: true, bootEpoch: snapshot.bootEpoch,
      generation: snapshot.generation, sessionPolicyRevision: snapshot.sessionPolicyRevision, leaseExpiresAtMs: snapshot.leaseExpiresAtMs,
      effectivePolicy: Object.freeze({ enabled: policy.enabled, mode: policy.mode, exportable: policy.exportable, codex: policy.codex, tools: false, personalMemory: false, autoMemory: false }),
      queuedCount: snapshot.queuedCount ?? null, dispatchedCount: snapshot.dispatchedCount ?? null });
  }
  async runtime(scope, session) {
    const snapshot = await this.runtimeState(scope, session);
    if (!snapshot.generation || snapshot.leaseExpiresAtMs <= Date.now() || snapshot.effectivePolicy.enabled !== true) throw new AiError('Obus requires an enabled, current game-host generation.');
    return Object.freeze({ ...runtimeFence(snapshot), leaseExpiresAtMs: snapshot.leaseExpiresAtMs });
  }
  async generate({ instructions, evidence, maxTokens = 900, signal, scope, task, session, requestId, policy }) {
    let job;
    try { job = structuredClone({ contract: 'raph-obus-game-v1', scope, task, session, requestId, instructions, evidence,
      policy: { ...policy, tools: false, personal_memory: false, auto_memory: false }, max_tokens: maxTokens }); }
    catch { throw new AiError('Invalid Obus game request.'); }
    await this.capabilities();
    const runtime = runtimeFence(await this.runtime(job.scope, job.session));
    policy = job.policy;
    // Obus owns retrieval, advisor selection, model choice, fallback, escalation,
    // and generation. The game never calls a model or external provider itself.
    const result = await boundedJson(await this.fetch(`${this.url}/api/game/route`, {
      method: 'POST', redirect: 'error', signal, headers: this.headers(),
      body: JSON.stringify({ ...job, runtime }),
    }));
    if (!result.routeId || !Array.isArray(result.trace) || result.trace.length === 0 || result.tool_calls?.length) throw new AiError('Obus returned no verifiable route trace.');
    if (!result.trace.every(stage => ['local', 'free', 'codex'].includes(stage.destination)
      && (stage.destination !== 'codex' || policy.codex === true)
      && (stage.destination !== 'free' || (policy.mode === 'local-free' && stage.cost === 'zero'))
      && (stage.destination === 'local' || policy.exportable === true))) throw new AiError('Obus route violated the campaign provider policy.');
    sameRuntime(runtime, await this.runtime(job.scope, job.session));
    return { text: result.text, provider: 'obus', model: result.model || null, routeId: result.routeId, trace: result.trace, sources: result.sources || [] };
  }
  async transcribe(bytes, context) {
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
    if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > 6000000 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new AiError('Invalid audio segment.');
    if (!id(context?.scope?.owner) || !['host', 'player'].includes(context.scope.role) || !id(context.session) || !id(context.requestId)) throw new AiError('Current campaign and session authorization is required for speech.');
    const runtime = runtimeFence(context.capturedRuntime);
    const captureExpiry = context.capturedRuntime.leaseExpiresAtMs;
    if (!Number.isSafeInteger(captureExpiry) || captureExpiry <= Date.now() || !Number.isSafeInteger(context.capturedConsentEpoch) || context.capturedConsentEpoch < 0) throw new AiError('A current captured consent grant and lease are required for speech.');
    const job = { contract: 'raph-obus-game-stt-v1', scope: { campaign: context.scope.campaign, owner: context.scope.owner, role: context.scope.role }, session: context.session,
      requestId: context.requestId, audio_base64: bytes.toString('base64'), mime_type: 'audio/wav', runtime };
    sameRuntime(runtime, await this.runtime(job.scope, job.session));
    if (captureExpiry <= Date.now()) throw new AiError('The captured audio lease expired before upload.');
    const result = await boundedJson(await this.fetch(`${this.url}/api/voice/transcribe`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: this.headers(),
      body: JSON.stringify(job),
    }));
    if (result.status === 'completed_receipt_only') {
      const error = new AiError('This speech request has a saved receipt but no retained transcript. It will not be run again.');
      error.code = 'RECEIPT_ONLY'; throw error;
    }
    const transcript = result.result;
    if (result.status !== 'completed' || transcript?.kind !== 'transcript' || typeof transcript.text !== 'string' || transcript.text.length > 6000 || !Array.isArray(transcript.trace) || transcript.trace.length === 0 || !transcript.trace.every(stage => stage?.destination === 'local')) throw new AiError('No usable local transcript.');
    sameRuntime(runtime, await this.runtime(job.scope, job.session));
    return transcript.text.trim();
  }
}
