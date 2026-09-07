import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const methods = new Set(['sft', 'dpo']);
// This checks obvious accidental credentials; it is not a complete privacy scanner.
const secretLike = /(?:sk-[a-zA-Z0-9_-]{12,}|hf_[a-zA-Z0-9]{12,}|(?:api[_ -]?key|authorization|password)\s*[:=]\s*\S+)/i;
const fail = (id, reason) => { throw new Error(`Example ${id || '(unknown)'}: ${reason}`); };
function messages(value, id, assistantOnly = false) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) fail(id, 'messages must contain 1–20 entries');
  for (const m of value) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 16000 || Object.keys(m).some(k => !['role', 'content'].includes(k))) fail(id, 'invalid message');
    if (secretLike.test(m.content)) fail(id, 'possible credential requires removal and review');
  }
  if (assistantOnly && (value.length !== 1 || value[0].role !== 'assistant')) fail(id, 'preference completion must be one assistant message');
  return value.map(m => ({ role: m.role, content: m.content }));
}
export function curate(records, { method = 'sft', evalPercent = 20 } = {}) {
  if (!methods.has(method)) throw new Error('Use sft or dpo.');
  if (!Number.isInteger(evalPercent) || evalPercent < 1 || evalPercent > 50) throw new Error('Evaluation percentage must be 1–50.');
  if (!Array.isArray(records) || records.length < 2 || records.length > 100000) throw new Error('Provide 2–100000 reviewed examples.');
  const ids = new Set(), hashes = new Set(), rows = [];
  for (const record of records) {
    const id = record?.id;
    if (!identifier(id) || ids.has(id)) fail(id, 'missing or duplicate identifier');
    ids.add(id);
    if (!identifier(record.campaignGroup)) fail(id, 'use a pseudonymous campaign group');
    if (record.review?.approved !== true || record.review?.privacyChecked !== true || !identifier(record.review?.reviewerId)) fail(id, 'explicit content and privacy review required');
    if (!['original', 'licensed'].includes(record.rights?.kind) || typeof record.rights?.evidence !== 'string' || !record.rights.evidence.trim()) fail(id, 'reuse rights evidence required');
    if (record.visibility !== 'player_safe' || record.purpose !== 'narration' || record.containsHiddenState !== false) fail(id, 'only player-safe narration may be exported');
    if (!Array.isArray(record.sourceEventIds) || !record.sourceEventIds.length || !record.sourceEventIds.every(identifier)) fail(id, 'validated source event references required');
    let row;
    if (method === 'sft') {
      const ms = messages(record.messages, id);
      if (ms.at(-1).role !== 'assistant' || !ms.some(m => m.role === 'user')) fail(id, 'SFT needs a user request and final assistant response');
      row = { messages: ms };
    } else {
      const prompt = messages(record.prompt, id);
      if (prompt.at(-1).role !== 'user') fail(id, 'DPO prompt must end with the user request');
      row = { prompt, chosen: messages(record.chosen, id, true), rejected: messages(record.rejected, id, true) };
      if (JSON.stringify(row.chosen) === JSON.stringify(row.rejected)) fail(id, 'preference answers must differ');
    }
    const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    if (hashes.has(hash)) fail(id, 'duplicate training content');
    hashes.add(hash);
    rows.push({ id, group: record.campaignGroup, hash, row });
  }
  // Split whole campaigns, never individual turns, to prevent same-session leakage.
  const groups = [...new Set(rows.map(r => r.group))].sort((a, b) => {
    const h = value => createHash('sha256').update('raph-split-v1:' + value).digest('hex');
    return h(a).localeCompare(h(b));
  });
  if (groups.length < 2) throw new Error('At least two independent campaign groups are required.');
  const evalGroups = new Set(groups.slice(0, Math.max(1, Math.floor(groups.length * evalPercent / 100))));
  const train = [], evaluation = [], provenance = [];
  for (const item of rows) {
    const split = evalGroups.has(item.group) ? 'evaluation' : 'train';
    (split === 'train' ? train : evaluation).push(item.row);
    provenance.push({ id: item.id, group: item.group, hash: item.hash, split });
  }
  return { train, evaluation, manifest: { schemaVersion: 1, method, groups: groups.length, trainCount: train.length, evaluationCount: evaluation.length, splitPolicy: 'whole_campaign_sha256_v1', reviewBoundary: 'Reviewer declarations are required; this validator cannot establish truth of rights, events or semantic privacy.', provenance } };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' }, method: { type: 'string', default: 'sft' } } });
  if (!values.input || !values.out) throw new Error('Supply --input reviewed.jsonl --out NEW_DIRECTORY [--method sft|dpo].');
  const raw = await readFile(resolve(values.input), 'utf8');
  if (Buffer.byteLength(raw) > 32 * 1024 * 1024) throw new Error('Split inputs larger than 32 MiB before curation.');
  const records = raw.split(/\r?\n/).filter(line => line.trim()).map((line, i) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on nonempty record ${i + 1}.`); } });
  const result = curate(records, { method: values.method });
  const out = resolve(values.out);
  await mkdir(resolve(out, '..'), { recursive: true });
  await mkdir(out);
  for (const name of ['train', 'evaluation']) await writeFile(resolve(out, `${name}.jsonl`), result[name].map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ train: result.train.length, evaluation: result.evaluation.length, status: 'curated_locally_not_uploaded' }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
