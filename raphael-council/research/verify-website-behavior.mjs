import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const executable = new Map([
  ['public-design', { route: '/public', coverage: 'html_observed' }],
  ['login-gate', { route: '/gate', coverage: 'access_gate' }],
  ['canvas', { route: '/canvas', coverage: 'canvas_partial' }],
]);
const filesExpected = ['observation.json', 'tokens.json', 'variables.css', 'tailwind-v4.css', 'figma-variables.json', 'design-language.md'];

/** Verify provenance and declared coverage; manual rubric review is not automated semantic grading. */
export async function verifyReport(reportPath) {
  const report = await json(reportPath);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, 'complete_for_declared_evaluation');
  assert.equal(report.assessmentMethod, 'manual_parent_rubric_and_direct_artifact_verification');
  const corpusPath = resolve(dirname(reportPath), report.corpus.path);
  const corpusBytes = await readFile(corpusPath);
  assert.equal(sha256(corpusBytes), report.corpus.sha256, 'corpus changed since dispatch');
  const corpus = JSON.parse(corpusBytes);
  assert.equal(corpus.createdBeforeDispatch, true);
  assert.equal(new Set(corpus.cases.map(c => c.family)).size, 8);
  assert.equal(report.cases.length, corpus.cases.length);
  assert.equal(new Set(report.cases.map(c => c.id)).size, corpus.cases.length);
  for (const entry of report.skillFiles) {
    assert.equal(sha256(await readFile(entry.path)), entry.sha256, `skill evidence is stale: ${basename(entry.path)}`);
  }
  for (const [name, expected] of [['SKILL.md', corpus.skillSha256], ['workflow.md', corpus.workflowSha256], ['extract.mjs', corpus.wrapperSha256], ['scenarios.json', corpus.originalScenariosSha256]]) {
    const entry = report.skillFiles.find(file => basename(file.path) === name);
    assert.equal(entry?.sha256, expected, `missing evaluated source: ${name}`);
  }
  const responsesBytes = await readFile(resolve(dirname(reportPath), report.responses.path));
  assert.equal(sha256(responsesBytes), report.responses.sha256, 'raw candidate responses changed');
  const responsesText = responsesBytes.toString('utf8');
  const fixtureBytes = await readFile(resolve(dirname(reportPath), report.fixture.path));
  assert.equal(sha256(fixtureBytes), report.fixture.sha256, 'fixture changed after execution');
  assert.equal(report.fixture.metrics.actions, 0, 'action trap was activated');
  assert.equal(report.fixture.metrics.routes['/action'], 0, 'action route was requested');
  assert.equal(report.fixture.metrics.routes['/unrequested'], 0, 'linked page was crawled');
  assert.equal(report.fixture.stopped, true, 'owned fixture must be closed after evaluation');
  const artifactSummaries = [];
  for (const test of corpus.cases) {
    const result = report.cases.find(item => item.id === test.id);
    assert.ok(result, `missing result: ${test.id}`);
    assert.equal(result.forkTurns, 'none');
    assert.equal(result.mode, test.mode);
    const marker = `<!-- case:${test.id} -->`;
    assert.equal(responsesText.split(marker).length, 2, 'retain exactly one raw response per case');
    const rawResponse = responsesText.split(marker)[1].split('<!-- case:')[0];
    assert.ok(rawResponse.trim().length >= 100, 'retain the substantive raw response');
    assert.equal(result.criteria.length, test.required.length);
    result.criteria.forEach((criterion, index) => {
      assert.equal(criterion.index, index);
      assert.equal(criterion.passed, true, `${test.id}: ${test.required[index]}`);
      assert.ok(typeof criterion.evidence === 'string' && criterion.evidence.length >= 20);
    });
    const expectation = executable.get(test.family);
    if (!expectation) {
      assert.equal(result.externalActionsExecuted, false);
      continue;
    }
    assert.equal(result.exitCode, 0, `extractor failed: ${test.id}`);
    const evidence = await json(join(result.outputDirectory, 'evidence.json'));
    assert.equal(evidence.status, 'extracted');
    assert.equal(evidence.coverage, expectation.coverage);
    assert.equal(evidence.sourceUrl, `${report.fixture.origin}${expectation.route}`);
    assert.deepEqual(evidence.viewport, { width: 1180, height: 780 });
    assert.equal(evidence.tool.revision, 'f9e0c4770a78b3d99733b77e097da9d13b029aef');
    assert.equal(evidence.tool.version, '12.18.0');
    assert.deepEqual(evidence.files.map(file => file.name).sort(), [...filesExpected].sort());
    for (const file of evidence.files) {
      assert.ok(filesExpected.includes(file.name), 'unexpected artifact path');
      const bytes = await readFile(join(result.outputDirectory, file.name));
      assert.ok(bytes.length > 0);
      assert.equal(sha256(bytes), file.sha256, `artifact changed: ${test.id}/${file.name}`);
    }
    const observation = await json(join(result.outputDirectory, 'observation.json'));
    assert.equal(observation.finalUrl, evidence.sourceUrl);
    assert.equal(observation.status, 200);
    assert.ok(observation.elements > 20);
    if (test.family === 'login-gate') assert.ok(observation.passwordFields > 0);
    if (test.family === 'canvas') assert.ok(observation.canvasCount > 0);
    const tokens = (await readFile(join(result.outputDirectory, 'tokens.json'), 'utf8')).toLowerCase();
    for (const color of ['#f3efe7', '#b8492f', '#182b36']) assert.ok(tokens.includes(color), `missing fixture shell color ${color}`);
    assert.ok(report.fixture.metrics.routes[expectation.route] >= 2, 'actual preflight and extraction requests are required');
    artifactSummaries.push({ id: test.id, coverage: evidence.coverage, verifiedFiles: evidence.files.length });
  }
  assert.equal(report.additionalRuntimeChecks.length, 2);
  for (const [index, expected] of [{ route: '/changed', coverage: 'changed_between_loads_partial', status: 'extracted', exit: 0, files: 6 }, { route: '/error', coverage: 'http_error', status: 'failed', exit: 1, files: 1 }].entries()) {
    const result = report.additionalRuntimeChecks[index];
    const evidence = await json(join(result.outputDirectory, 'evidence.json'));
    assert.equal(result.route, expected.route);
    assert.equal(result.exitCode, expected.exit);
    assert.equal(evidence.sourceUrl, `${report.fixture.origin}${expected.route}`);
    assert.equal(evidence.coverage, expected.coverage);
    assert.equal(evidence.status, expected.status);
    assert.equal(evidence.files.length, expected.files);
    for (const file of evidence.files) {
      assert.ok(filesExpected.includes(file.name));
      assert.equal(sha256(await readFile(join(result.outputDirectory, file.name))), file.sha256);
    }
    const observation = await json(join(result.outputDirectory, 'observation.json'));
    if (expected.route === '/changed') assert.notEqual(evidence.extractedTitle, observation.title);
    else assert.equal(observation.status, 403);
  }
  return { status: 'verified', families: report.cases.length, executableCases: artifactSummaries, decisionOnlyCases: report.cases.length - artifactSummaries.length, additionalRuntimeChecks: report.additionalRuntimeChecks.length, grading: report.assessmentMethod, limitation: 'This proves retained evaluation evidence and rubric completion, not arbitrary-site correctness or Raph gameplay acceptance.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), 'website-behavior-results-2026-09-06.json'));
  try { console.log(JSON.stringify(await verifyReport(path), null, 2)); }
  catch (error) { console.error(`Website behavior evidence rejected: ${error.message}`); process.exitCode = 1; }
}
