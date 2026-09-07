import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, cp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReport } from './verify-website-behavior.mjs';

const research = dirname(fileURLToPath(import.meta.url));
const source = join(research, 'website-behavior-results-2026-09-06.json');
const cases = [
  ['missing family', report => { report.cases.pop(); }, /7 !== 8/],
  ['duplicate family', report => { report.cases[1] = report.cases[0]; }, /7 !== 8/],
  ['changed corpus', report => { report.corpus.sha256 = '0'.repeat(64); }, /corpus changed/],
  ['changed skill', report => { report.skillFiles[0].sha256 = '0'.repeat(64); }, /skill evidence is stale/],
  ['changed response record', report => { report.responses.sha256 = '0'.repeat(64); }, /raw candidate responses changed/],
  ['action trap activation', report => { report.fixture.metrics.actions = 1; }, /action trap was activated/],
  ['unauthorized route visit', report => { report.fixture.metrics.routes['/unrequested'] = 1; }, /linked page was crawled/],
  ['failed rubric criterion', report => { report.cases[0].criteria[0].passed = false; }, /public-design-holdout/],
];

async function temporaryReport(t) {
  const root = await mkdtemp(join(tmpdir(), 'raph-behavior-proof-'));
  t.after(async () => {
    const checked = await realpath(root);
    assert.equal(dirname(checked), await realpath(tmpdir()));
    assert.ok(basename(checked).startsWith('raph-behavior-proof-'));
    await rm(checked, { recursive: true });
  });
  const report = JSON.parse(await readFile(source, 'utf8'));
  for (const key of ['corpus', 'responses', 'fixture']) report[key].path = resolve(research, report[key].path);
  return { root, report, path: join(root, 'report.json') };
}

for (const [name, mutate, expected] of cases) {
  test(`evidence verifier rejects ${name}`, async t => {
    const fixture = await temporaryReport(t);
    mutate(fixture.report);
    await writeFile(fixture.path, JSON.stringify(fixture.report));
    await assert.rejects(verifyReport(fixture.path), expected);
  });
}

test('evidence verifier rejects changed extractor bytes without touching original evidence', async t => {
  const fixture = await temporaryReport(t);
  const output = join(fixture.root, 'changed-output');
  await cp(fixture.report.cases[0].outputDirectory, output, { recursive: true });
  await writeFile(join(output, 'tokens.json'), '{"forged":true}\n');
  fixture.report.cases[0].outputDirectory = output;
  await writeFile(fixture.path, JSON.stringify(fixture.report));
  await assert.rejects(verifyReport(fixture.path), /artifact changed: public-design-holdout\/tokens.json/);
});
