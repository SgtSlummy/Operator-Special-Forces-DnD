// Opt-in network QA against the publisher's blank sheet. No player data is used.
// The downloaded PDF stays in memory; only an inspection PNG is written locally.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdf, renderPage } from './pdf.mjs';
import { OFFICIAL_CORE } from './templates.mjs';
import { EXPECTED } from './fixtures.mjs';

const response = await fetch('https://media.dndbeyond.com/compendium-images/free-rules/downloads/2024-character-sheet.pdf', { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Publisher download failed: ${response.status}`);
const pdf = await PDFDocument.load(await response.arrayBuffer());
for (const [key, name] of OFFICIAL_CORE) if (EXPECTED[key] !== undefined) pdf.getForm().getTextField(name).setText(String(EXPECTED[key]));
const filled = await pdf.save();
const verify = async (bytes, label) => {
  const draft = await extractPdf(bytes);
  const actual = Object.fromEntries(Object.keys(EXPECTED).map(key => [key, draft.fields[key]?.value]));
  assert.deepEqual(actual, EXPECTED, `${label}: core statistics`);
  console.log(`${label}: all ${Object.keys(EXPECTED).length} core statistics verified`);
};
await verify(filled, 'Official 2024 fillable');
pdf.getForm().flatten();
const flat = await pdf.save();
await verify(flat, 'Official 2024 flattened');
const loading = getDocument({ data: Uint8Array.from(flat) });
const render = await loading.promise;
try {
  const { png } = await renderPage(await render.getPage(1), 0, 300);
  await mkdir('tmp/character-qa', { recursive: true });
  await writeFile('tmp/character-qa/official-filled.png', png);
  const scan = await PDFDocument.create();
  const image = await scan.embedPng(png);
  scan.addPage([603, 774]).drawImage(image, { x: 0, y: 0, width: 603, height: 774 });
  await verify(await scan.save(), 'Official 2024 scanned');
} finally { await loading.destroy(); }
