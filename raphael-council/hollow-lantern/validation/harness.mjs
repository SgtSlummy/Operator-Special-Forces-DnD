import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const IMAGE = 'docker.io/library/node:24.17.0-bookworm-slim';
const MODEL = 'obus-qwen3.8-27b:65k';
const endpoint = 'http://127.0.0.1:11434/api/chat';
const worker = String.raw`
const fs=require('node:fs'),os=require('node:os'),net=require('node:net'),readline=require('node:readline');
const rl=readline.createInterface({input:process.stdin});let stage=0;
rl.on('line',async line=>{try{const input=JSON.parse(line);if(stage++===0){
 let writeBlocked=false;try{fs.writeFileSync('/isolation-proof','x')}catch{writeBlocked=true}
 const networkBlocked=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:11434});s.setTimeout(1000);s.on('connect',()=>{s.destroy();resolve(false)});s.on('error',()=>resolve(true));s.on('timeout',()=>{s.destroy();resolve(true)})});
 const proof={pid:process.pid,uid:process.getuid(),rootEntries:fs.readdirSync('/'),environmentKeys:Object.keys(process.env).sort(),interfaces:Object.keys(os.networkInterfaces()),writeBlocked,networkBlocked,noNewPrivileges:fs.readFileSync('/proc/self/status','utf8').match(/NoNewPrivs:\s+(\d+)/)?.[1],mounts:fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').filter(l=>l.includes(' / ')||l.includes(' /workspace '))};
 process.stdout.write(JSON.stringify({kind:'request',proof,messages:[{role:'user',content:input.task,images:input.images}]})+'\n');
 }else{process.stdout.write(JSON.stringify({kind:'answer',answer:input.answer})+'\n');rl.close();}}catch{process.stdout.write(JSON.stringify({kind:'error',code:'participant_input_invalid'})+'\n');process.exitCode=1;rl.close()}});
`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function command(args, timeoutMs = 20000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('podman', args, { windowsHide: true }); let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('podman_timeout')); }, timeoutMs);
    child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); code === 0 ? resolvePromise(out) : reject(new Error(`podman_failed:${err.slice(0, 120)}`)); });
  });
}
export function expectation(projection, actorId) {
  const actor = projection.characters.find(a => a.characterId === actorId);
  if (!actor?.position) throw new Error('Expected actor missing from controller projection');
  const map = projection.map;
  return { coordinate: { x: actor.position.x + 1, y: actor.position.y + 1 }, obscured: (map.cells ?? []).filter(c => c.visibility === 'visible' || c.visibility === 'remembered').length < map.width * map.height };
}
export function evaluate(text, before, after) {
  let answer;
  try { answer = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch { return { passed: false, reason: 'answer_not_json', rawAnswer: text }; }
  const coordinate = (a, b) => a?.x === b.x && a?.y === b.y;
  const checks = { before: coordinate(answer.before, before.coordinate), after: coordinate(answer.after, after.coordinate), movement: answer.moved === !coordinate(before.coordinate, after.coordinate), fog: answer.hasObscuredTerrain === after.obscured };
  return { passed: Object.values(checks).every(Boolean), checks, answer };
}

async function participant({ name, task, images, directory, timeoutMs = 180000 }) {
  const containerName = `hl-visual-${randomUUID()}`;
  const args = ['run', '--rm', '--name', containerName, '--network', 'none', '--http-proxy=false', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--user', '65534:65534', '--workdir', '/', '--interactive', IMAGE, 'node', '-e', worker];
  const child = spawn('podman', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout }); let stderr = '', proof, inspection, inference;
  child.stdin.on('error', () => {});
  child.on('error', error => { stderr = `spawn:${error.code ?? 'failed'}`; });
  child.stderr.on('data', b => stderr += b.toString().slice(0, 200));
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    child.stdin.write(JSON.stringify({ task, images: images.map(b => b.toString('base64')) }) + '\n');
    for await (const line of lines) {
      const event = JSON.parse(line);
      if (event.kind === 'request') {
        proof = event.proof;
        inspection = JSON.parse(await command(['inspect', containerName]))[0];
        const isolation = { networkMode: inspection.HostConfig?.NetworkMode, readonlyRootfs: inspection.HostConfig?.ReadonlyRootfs, capDrop: inspection.HostConfig?.CapDrop, securityOpt: inspection.HostConfig?.SecurityOpt, binds: inspection.HostConfig?.Binds, mounts: inspection.Mounts, memory: inspection.HostConfig?.Memory, pidsLimit: inspection.HostConfig?.PidsLimit, proof };
        await writeFile(join(directory, `${name}-isolation.json`), JSON.stringify(isolation, null, 2));
        if (!proof.writeBlocked || !proof.networkBlocked || proof.interfaces.some(i => i !== 'lo') || proof.environmentKeys.some(k => /TOKEN|SECRET|PASSWORD|API_KEY|PROXY/i.test(k)) || proof.noNewPrivileges !== '1' || inspection.HostConfig?.NetworkMode !== 'none' || !inspection.HostConfig?.ReadonlyRootfs || (inspection.HostConfig?.Binds ?? []).length || (inspection.Mounts ?? []).length) throw new Error('isolation_proof_failed');
        const started = Date.now();
        const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs - 10000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages: event.messages, stream: false, think: false, keep_alive: '5m', options: { temperature: 0, num_predict: 500 } }) });
        if (!response.ok) throw new Error('local_vision_unavailable');
        const result = await response.json();
        if (result.model !== MODEL || result.message?.tool_calls?.length) throw new Error('unexpected_model_response');
        inference = { model: result.model, durationMs: Date.now() - started, promptTokens: result.prompt_eval_count, responseTokens: result.eval_count, contextMessages: 1, tools: false, retrieval: false, cloud: false };
        child.stdin.end(JSON.stringify({ answer: result.message.content }) + '\n');
      } else if (event.kind === 'answer') return { answer: event.answer, inference, isolated: true };
      else throw new Error('participant_failed');
    }
    throw new Error(`participant_closed:${stderr.slice(0, 80)}`);
  } finally {
    clearTimeout(timer); lines.close(); child.kill();
    await command(['rm', '--force', containerName]).catch(() => {});
  }
}

export async function runVisualTrial({ sourceDirectory, outputRoot }) {
  const directory = resolve(outputRoot, `visual-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true });
  const participants = [{ id: 'lantern-fighter', actor: 'lantern-fighter' }, { id: 'lantern-rogue', actor: 'lantern-rogue' }, { id: 'lantern-cleric', actor: 'lantern-cleric' }, { id: 'gm', actor: 'lantern-fighter' }];
  const results = []; let failures = 0;
  for (const person of participants) {
    if (failures >= 2) { results.push({ participant: person.id, status: 'not-run', reason: 'bounded_failure_stop' }); continue; }
    const stems = [`01-initial-${person.id}`, `03-movement-${person.id}`];
    const projections = await Promise.all(stems.map(async stem => JSON.parse(await readFile(join(sourceDirectory, `${stem}.json`), 'utf8')).projection));
    const expected = projections.map(p => expectation(p, person.actor));
    const displayName = projections[0].characters.find(a => a.characterId === person.actor).displayName;
    const images = await Promise.all(stems.map(stem => readFile(join(sourceDirectory, `${stem}.png`))));
    const task = `You are ${person.id === 'gm' ? 'the DM looking at the party map' : `a player controlling ${displayName}`}. Look only at these two game screens, in order. Read ${displayName}'s map coordinates before and after. Did that character move? Does the second screen have unexplored dark terrain hidden by fog? Use the coordinate labels shown in the image. If you cannot tell, use null; do not guess. Reply with JSON only: {"before":{"x":number,"y":number},"after":{"x":number,"y":number},"moved":boolean,"hasObscuredTerrain":boolean,"description":"what you can see"}.`;
    await writeFile(join(directory, `${person.id}-controller-only.json`), JSON.stringify({ expected, sourceHashes: images.map(hash), revisions: projections.map(p => p.revision), sourceKind: 'local PNG rendered from actual Unity projection; not Discord capture' }, null, 2));
    await writeFile(join(directory, `${person.id}-participant-input.json`), JSON.stringify({ task, imageHashes: images.map(hash), ordinaryControls: [], memory: 'fresh single visual turn' }, null, 2));
    try {
      const result = await participant({ name: person.id, task, images, directory });
      const verdict = evaluate(result.answer, expected[0], expected[1]);
      results.push({ participant: person.id, ...result, verdict }); if (!verdict.passed) failures++;
    } catch (error) { results.push({ participant: person.id, status: 'failed', reason: error.message.slice(0, 150) }); failures++; }
    await writeFile(join(directory, 'results.json'), JSON.stringify(results, null, 2));
  }
  const report = { trial: 'isolated screenshot-only local vision trial', directory, results, limitations: ['No live Discord or browser interaction was tested.', 'No gameplay commands were submitted by these participants.', 'No full mission acceptance is claimed.', 'Model weights and local serving process are shared; prompts and screenshot-only histories are separate stateless requests.', 'Expected answers and engine projections remained in the trusted controller, outside participant containers and model messages.'] };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runVisualTrial({ sourceDirectory: process.argv[2], outputRoot: process.argv[3] });
  console.log(JSON.stringify({ directory: report.directory, results: report.results.map(r => ({ participant: r.participant, passed: r.verdict?.passed, status: r.status, reason: r.reason })) }, null, 2));
}
