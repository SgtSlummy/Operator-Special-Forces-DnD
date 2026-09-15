import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { captureEvidenceSelection, isEvidenceAppend } from './evidence-selection.mjs';
import { prepareEvidenceProjection, prepareEvidenceDocument } from './host-control.mjs';

const participant = (user = 'alice', extra = {}) => ({ user, capture: true, external: true, captureEpoch: 1, externalEpoch: 2, ...extra });
const source = (ref = 'entry-1', extra = {}) => ({ ref, revision: 1, audience: 'party', owner: '', text: 'The beacon is blue.', provenance: `chronicle:${ref}`,
  deleted: false, contributors: [{ user: 'alice', captureEpoch: 1, externalEpoch: 2, exportableAtCapture: true }], derivesFrom: [], ...extra });
const projection = (extra = {}) => ({ contract: 'raph-obus-game-evidence-v1', campaign: 'harbor', session: 'selection-session', revision: 3,
  sources: [source()], participants: [participant()], ...extra });
const refs = [{ ref: 'entry-1', revision: 1 }];
const capture = input => captureEvidenceSelection(input, refs);

test('selection stays stable across unrelated source, participant and snapshot changes', () => {
  const before = projection({ participants: [participant(), participant('other')], sources: [source(), source('unrelated')] });
  const saved = capture(before), after = structuredClone(before);
  after.revision++;
  after.sources[1].revision++; after.sources[1].text = 'An unrelated correction.';
  after.sources.push(source('new-chat'));
  after.participants[1].external = false; after.participants[1].externalEpoch++;
  const current = capture(after);
  assert.equal(current.evidence.selectionHash, saved.evidence.selectionHash);
  assert.equal(saved.evidence.revision, 3); assert.equal(current.evidence.revision, 4);
  assert.deepEqual(saved.references, refs);
  assert.ok(!JSON.stringify(saved).includes('beacon'));
  assert.ok(Object.isFrozen(saved.evidence.references[0]));
  before.sources[0].text = 'Caller mutation';
  assert.equal(saved.evidence.selectionHash, current.evidence.selectionHash);
});

test('complete selected content, lineage, scope and current consent are bound', async t => {
  const before = projection(), hash = capture(before).evidence.selectionHash;
  for (const [name, mutate] of Object.entries({
    text: value => { value.sources[0].text = 'A red beacon.'; },
    provenance: value => { value.sources[0].provenance = 'corrected'; },
    audience: value => { value.sources[0].audience = 'host'; },
    owner: value => { value.sources[0].owner = 'different'; },
    lineage: value => { value.sources[0].contributors[0].exportableAtCapture = false; },
    consent: value => { value.participants[0].external = false; value.participants[0].externalEpoch++; },
    capture: value => { value.participants[0].capture = false; value.participants[0].captureEpoch++; },
    missing: value => { value.participants = []; },
    campaign: value => { value.campaign = 'other'; },
    session: value => { value.session = 'other'; },
  })) await t.test(name, () => {
    const changed = structuredClone(before); mutate(changed);
    assert.notEqual(capture(changed).evidence.selectionHash, hash);
  });
});

test('derived selections include every ancestor and its current consent', () => {
  const input = projection({ sources: [source(), source('summary', { contributors: [], derivesFrom: refs })] });
  const requested = [{ ref: 'summary', revision: 1 }];
  const first = captureEvidenceSelection(input, requested);
  assert.deepEqual(first.references, [...refs, ...requested]);
  input.participants[0].externalEpoch++;
  assert.notEqual(captureEvidenceSelection(input, requested).evidence.selectionHash, first.evidence.selectionHash);
});

test('missing, stale, deleted, cyclic and excessive source closures are rejected', async t => {
  for (const [name, input] of Object.entries({
    missing: projection({ sources: [] }),
    stale: projection({ sources: [source('entry-1', { revision: 2 })] }),
    deleted: projection({ sources: [source('entry-1', { deleted: true, text: '' })] }),
    cycle: projection({ sources: [source('entry-1', { derivesFrom: refs })] }),
    ancestor: projection({ sources: [source('entry-1', { derivesFrom: [{ ref: 'missing', revision: 1 }] })] }),
    excessive: projection({ sources: [source('entry-1', { text: '', derivesFrom: Array.from({ length: 32 }, (_, i) => ({ ref: `a${i}`, revision: 1 })) }),
      ...Array.from({ length: 32 }, (_, i) => source(`a${i}`, { text: '' }))] }),
    text: projection({ sources: [source('entry-1', { text: 'x'.repeat(16000), derivesFrom: [{ ref: 'extra', revision: 1 }] }), source('extra')] }),
  })) await t.test(name, () => assert.throws(() => capture(input), { code: 'INVALID_EVIDENCE_SELECTION' }));
});

test('strict reference data cannot execute getters or broaden the selection', () => {
  for (const input of [[], [...refs, ...refs], [{ ...refs[0], text: 'injected' }], [{ ref: 'entry-1', revision: true }], new Array(1)]) {
    assert.throws(() => captureEvidenceSelection(projection(), input));
  }
  let calls = 0;
  const getter = Object.defineProperty({ revision: 1 }, 'ref', { enumerable: true, get() { calls++; return 'entry-1'; } });
  assert.throws(() => captureEvidenceSelection(projection(), [getter]));
  const body = projection(); Object.defineProperty(body.sources[0], 'text', { enumerable: true, get() { calls++; return 'secret'; } });
  assert.throws(() => capture(body)); assert.equal(calls, 0);
});

test('local projection preparation grants no runtime envelope and leaves signed validation strict', () => {
  const input = projection();
  assert.ok(Object.isFrozen(prepareEvidenceProjection(input).sources[0]));
  assert.throws(() => prepareEvidenceDocument(input));
  assert.throws(() => prepareEvidenceProjection({ ...input, runtime: {} }));
});

test('append compatibility permits new rows but never removal, rewrite, consent change or rollback', () => {
  const before = prepareEvidenceProjection(projection()), after = projection({ revision: 4, sources: [source(), source('new')], participants: [participant(), participant('new')] });
  assert.equal(isEvidenceAppend(before, prepareEvidenceProjection(after)), true);
  assert.equal(isEvidenceAppend(before, prepareEvidenceProjection(projection({ revision: 4 }))), true);
  for (const change of [value => { value.revision = 2; }, value => { value.revision = 3; },
    value => { value.sources[0].text = 'changed'; }, value => { value.sources.shift(); },
    value => { value.participants.shift(); }, value => { value.participants[0].external = false; }]) {
    const changed = structuredClone(after); change(changed);
    assert.equal(isEvidenceAppend(before, prepareEvidenceProjection(changed)), false);
  }
});

test('Unicode source and contributor ordering agrees with the real Python Obus resolver', { skip: !process.env.OBUS_EVIDENCE_TEST_ROOT }, () => {
  const users = ['\u{1f30a}', '\ue000'];
  const input = projection({ participants: users.map(user => participant(user)), sources: [source('entry-1', {
    text: 'A wave \u{1f30a}, a quote " and\nnew line.', contributors: users.map(user => ({ user, captureEpoch: 1, externalEpoch: 2, exportableAtCapture: true })),
    derivesFrom: users.map(ref => ({ ref, revision: 1 })),
  }), ...users.map(ref => source(ref, { contributors: [{ user: ref, captureEpoch: 1, externalEpoch: 2, exportableAtCapture: true }] }))] });
  const selected = capture(input), reversed = structuredClone(input);
  reversed.participants.reverse(); reversed.sources.reverse();
  for (const row of reversed.sources) { row.contributors.reverse(); row.derivesFrom.reverse(); }
  assert.deepEqual(capture(reversed), selected);
  const program = `import json,sqlite3,sys
from backend.game_evidence import EvidenceSnapshot,initialize_schema,save_snapshot,EvidenceDenied
from backend.game_evidence_selection import resolve_selection
value=json.loads(sys.stdin.buffer.read().decode('utf-8'))
body=value['projection']; request=value['request']
body['runtime']={'contract':'raph-obus-game-runtime-v1','bootEpoch':'boot','generation':'generation','sessionPolicyRevision':0}
db=sqlite3.connect(':memory:',isolation_level=None); initialize_schema(db); db.execute('BEGIN')
save_snapshot(db,EvidenceSnapshot.model_validate(body))
def resolve(): return resolve_selection(db,body['campaign'],body['session'],'gm','host',request,external=True)
first=resolve(); body['revision']+=1
body['sources'].append({**body['sources'][0],'ref':'unrelated','derivesFrom':[]})
save_snapshot(db,EvidenceSnapshot.model_validate(body)); assert resolve()==first
body['revision']+=1; body['participants'][0]['externalEpoch']+=1
save_snapshot(db,EvidenceSnapshot.model_validate(body))
try: resolve(); raise AssertionError('changed consent accepted')
except EvidenceDenied as error: assert error.code=='evidence_external_consent_required'
print(json.dumps({'sources':len(first['sources']),'revision':first['revision'],'consentDenied':True}))`;
  const root = process.env.OBUS_EVIDENCE_TEST_ROOT;
  const result = spawnSync(join(root, '.venv', 'Scripts', 'python.exe'), ['-c', program], { cwd: root, encoding: 'utf8', timeout: 15000,
    input: JSON.stringify({ projection: input, request: selected.evidence }) });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { sources: 3, revision: 3, consentDenied: true });
});
