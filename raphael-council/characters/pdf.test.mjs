import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractPdf, validatePdfBytes } from './pdf.mjs';
import { runWorker } from './service.mjs';
import { sheetFixture, EXPECTED, oversizedPageFixture, pageLimitFixture, encryptedFixture } from './fixtures.mjs';
import { issues } from './model.mjs';
const values = draft => Object.fromEntries(Object.keys(EXPECTED).map(key => [key, draft.fields[key]?.value]));
test('fillable and flattened PDFs preserve explicit core statistics', async () => {
  for (const kind of ['fillable', 'flattened']) {
    const draft = await extractPdf(await sheetFixture({ kind }));
    assert.deepEqual(values(draft), EXPECTED, kind);
    assert.equal(issues(draft).length, 0);
    assert.equal(draft.edition, null, 'edition must be confirmed, not read from the template');
  }
});
test('scanned, rotated and mixed PDFs work in the offline isolated worker', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'raphael-ocr-test-'));
  try {
    for (const options of [{ kind: 'scanned' }, { kind: 'scanned', rotation: 90 }, { kind: 'mixed' }]) {
      const path = join(directory, 'fixture.pdf');
      await writeFile(path, await sheetFixture(options));
      const draft = await runWorker(path, { timeoutMs: 55000 });
      assert.deepEqual(values(draft), EXPECTED, JSON.stringify(options));
      assert.ok(draft.fields.dexterity.evidence.some(e => e.method === 'ocr'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('worker preload actually denies outbound connections', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', new URL('./offline.mjs', import.meta.url).href,
    '--input-type=module', '-e', 'import net from "node:net"; try { net.connect(443, "example.com"); process.exit(1); } catch { console.log("blocked"); } try { await fetch("https://example.com"); process.exit(1); } catch { console.log("blocked"); }']);
  assert.equal(stdout.trim(), 'blocked\nblocked');
});
test('incomplete and conflicting sheets stay unresolved', async () => {
  assert.match(issues(await extractPdf(await sheetFixture({ incomplete: true }))).join('\n'), /dexterity.*required/i);
  assert.match(issues(await extractPdf(await sheetFixture({ conflict: true }))).join('\n'), /conflicting/);
});
test('malformed, oversized, and excessive-page PDFs fail closed', async () => {
  assert.throws(() => validatePdfBytes(Buffer.from('not a pdf')), /valid PDF/);
  assert.throws(() => validatePdfBytes(Buffer.alloc(10 * 1024 * 1024 + 1)), /valid PDF/);
  await assert.rejects(extractPdf(Buffer.from('%PDF-1.7\n invalid')), /malformed|encrypted/);
  await assert.rejects(extractPdf(await pageLimitFixture()), /30 pages/);
  await assert.rejects(extractPdf(await oversizedPageFixture()), /large/);
  await assert.rejects(extractPdf(await encryptedFixture()), /encrypted/);
});
