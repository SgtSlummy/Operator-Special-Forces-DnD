import { PDFDocument, PDFTextField, PDFDropdown, PDFOptionList } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { access } from 'node:fs/promises';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { emptyDraft, addEvidence, finishDraft, fieldFor, FIELDS, REQUIRED, parseValue, normalize } from './model.mjs';
import { OFFICIAL_CORE, officialForm, officialKey, officialValue, officialPositioned, isOfficialPositioned } from './templates.mjs';

export const LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, pages: 30, pixels: 16_000_000, timeoutMs: 600_000, ttlMs: 86_400_000 });
const require = createRequire(import.meta.url);
export const LANGUAGE_PATH = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');
export async function checkOcrAssets() { await access(join(LANGUAGE_PATH, 'eng.traineddata.gz')); }
export function validatePdfBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > LIMITS.bytes ||
    Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') throw new Error('Upload a valid PDF no larger than 10 MiB.');
}
const source = (page, method, confidence = null) => ({ page, method, confidence });
function specialField(name) {
  const n = normalize(name);
  if (/^(?:wpn|weapon|attack)/.test(n)) return 'attacks';
  if (/^spells\d/.test(n)) return 'spells';
  if (/^(?:feature|trait|feat)/.test(n)) return 'features';
  return null;
}
function mapFormName(name) {
  return fieldFor(name) ?? fieldFor(String(name).replace(/[_ .-]\d+$/, '')) ?? specialField(name);
}
function linesFromItems(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find(r => Math.abs(r.y - item.y) < 3);
    if (!row) rows.push(row = { y: item.y, items: [] });
    row.items.push(item);
  }
  return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' ').trim());
}
export function extractPositioned(draft, items, page, method, confidence = null, sourceOnly = false) {
  const evidence = source(page, method, confidence);
  const lines = linesFromItems(items);
  const official = !sourceOnly && officialPositioned(draft, items, page, method, confidence);
  const found = new Set();
  // Explicit labeled values are accepted on unfamiliar layouts too.
  for (const line of lines) {
    if (sourceOnly) break;
    const match = line.match(/^(.{1,60}?)\s*:\s*(.+)$/);
    const key = match && fieldFor(match[1]);
    if (key) { addEvidence(draft, key, match[2], evidence); found.add(key); }
  }
  for (const label of items) {
    if (official || sourceOnly) break;
    const key = fieldFor(label.text);
    if (!key || found.has(key)) continue;
    if (page > 1 && REQUIRED.includes(key)) continue;
    const spec = FIELDS[key];
    const candidates = items.filter(item => item !== label && !fieldFor(item.text) &&
      Math.abs(item.y - label.y) <= 32 && Math.abs(item.x + item.width / 2 - label.x - label.width / 2) <= Math.max(60, label.width) &&
      parseValue(key, item.text) !== null &&
      (spec.min === null || !['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].includes(key) || !/^[+-]/.test(item.text)))
      .map(item => ({ item, distance: Math.abs(item.y - label.y) + Math.abs(item.x + item.width / 2 - label.x - label.width / 2) / 2 }))
      .sort((a, b) => a.distance - b.distance);
    // Never assign an arbitrary adjacent word to identity/long-text fields.
    if (spec.min === null) continue;
    if (candidates.length && (candidates.length === 1 || candidates[1].distance - candidates[0].distance > 6)) {
      addEvidence(draft, key, candidates[0].item.text, evidence); found.add(key);
    }
  }
  // Keep visible unstructured material, including spells/feats, available for review.
  const text = lines.join('\n').slice(0, 24000);
  if (text) draft.unknown.push({ page, method, text });
  return found.size;
}
function ocrItems(result, scale) {
  const items = [];
  for (const block of result.data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
    const words = line.words ?? [];
    // Word spans permit a label and its value to be recognized independently.
    for (const word of words) items.push({ text: word.text.trim(), x: word.bbox.x0 / scale, y: word.bbox.y0 / scale, width: (word.bbox.x1 - word.bbox.x0) / scale });
    if (words.length > 1) {
      const text = words.map(w => w.text).join(' ');
      if (fieldFor(text)) items.push({ text, x: line.bbox.x0 / scale, y: line.bbox.y0 / scale, width: (line.bbox.x1 - line.bbox.x0) / scale });
    }
  }
  return items;
}
export async function renderPage(page, rotation = 0, dpi = 200) {
  const viewport = page.getViewport({ scale: dpi / 72, rotation: (page.rotate + rotation) % 360 });
  if (!Number.isFinite(viewport.width * viewport.height) || viewport.width * viewport.height > LIMITS.pixels) throw new Error('PDF page is too large to render safely.');
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const png = canvas.toBuffer('image/png');
  canvas.width = canvas.height = 1;
  return { png, scale: dpi / 72 };
}
async function readOfficialRegions(worker, png, scale, candidate, page) {
  for (const [key, , x0, y0, x1, y1] of OFFICIAL_CORE) {
    const numeric = FIELDS[key].min !== null;
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: numeric ? '0123456789+-' : '' });
    const result = await worker.recognize(png, { rectangle: {
      left: Math.floor((x0 + 1) * scale), top: Math.floor((774 - y1 + 1) * scale),
      width: Math.ceil((x1 - x0 - 2) * scale), height: Math.ceil((y1 - y0 - 2) * scale),
    } }, { text: true });
    const value = result.data.text.trim();
    if (!value) continue;
    addEvidence(candidate, key, value, source(page, 'ocr-region', result.data.confidence));
  }
  await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
}
export async function extractPdf(bytes, { onProgress = () => {} } = {}) {
  validatePdfBytes(bytes);
  let formPdf, pageCount;
  try { formPdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true }); pageCount = formPdf.getPageCount(); }
  catch { throw new Error('This PDF is malformed or encrypted. Export an unlocked PDF and try again.'); }
  if (formPdf.isEncrypted) throw new Error('Encrypted PDFs are not supported.');
  if (pageCount < 1 || pageCount > LIMITS.pages) throw new Error('Upload a PDF with 1 to 30 pages.');
  const draft = emptyDraft();
  const formFields = formPdf.getForm().getFields();
  if (formFields.length > 10000) throw new Error('This PDF contains too many fields.');
  const loading = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useSystemFonts: false,
    disableFontFace: true, stopAtErrors: true, maxImageSize: LIMITS.pixels,
    standardFontDataUrl: `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`,
    wasmUrl: `${join(dirname(require.resolve('pdfjs-dist/package.json')), 'wasm')}/` });
  let pdf, worker;
  try {
    pdf = await loading.promise;
    let knownOfficialForm = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress({ stage: 'reading', page: pageNumber, pages: pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations();
      if (pageNumber === 1) knownOfficialForm = officialForm(annotations, page.view[2] - page.view[0], page.view[3] - page.view[1]);
      const names = new Set(annotations.map(a => a.fieldName));
      for (const field of formFields.filter(f => names.has(f.getName()) || (pageNumber === 1 && names.size === 0))) {
        let value;
        if (field instanceof PDFTextField) value = field.getText();
        else if (field instanceof PDFDropdown || field instanceof PDFOptionList) value = field.getSelected().join(', ');
        else continue;
        if (!value) continue;
        const key = (knownOfficialForm && officialKey(field.getName())) || mapFormName(field.getName());
        if (key) addEvidence(draft, key, knownOfficialForm ? officialValue(field.getName(), key, value) : specialField(field.getName()) ? `${field.getName()}: ${value}` : value, source(pageNumber, 'form'));
        else draft.unknown.push({ page: pageNumber, method: 'form', text: `${field.getName()}: ${value}`.slice(0, 12000) });
      }
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const items = textContent.items.filter(item => item.str?.trim()).map(item => ({ text: item.str.trim(), x: item.transform[4], y: viewport.height - item.transform[5], width: item.width }));
      extractPositioned(draft, items, pageNumber, 'text', null, knownOfficialForm);
      const operators = await page.getOperatorList();
      const hasImage = operators.fnArray.some(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(op));
      if (!knownOfficialForm && (items.length < 8 || hasImage)) {
        onProgress({ stage: 'ocr', page: pageNumber, pages: pdf.numPages });
        if (!worker) {
          await checkOcrAssets();
          worker = await createWorker('eng', 1, { langPath: LANGUAGE_PATH, cacheMethod: 'none', gzip: true, logger: () => {}, errorHandler: () => {} });
        }
        let best;
        for (const rotation of [0, 90, 180, 270]) {
          const { png, scale } = await renderPage(page, rotation, 300);
          await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' });
          let result = await worker.recognize(png, { rotateAuto: true }, { text: true, blocks: true });
          let candidate = emptyDraft();
          let recognized = ocrItems(result, scale);
          extractPositioned(candidate, recognized, pageNumber, 'ocr', result.data.confidence);
          // Sparse-text detection finds labels inside decorative stat boxes which
          // ordinary paragraph segmentation omits. Crop only a positively matched
          // template; never apply hard-coded rectangles to an unfamiliar sheet.
          const normalizedText = normalize(result.data.text);
          if (normalizedText.includes('speciestraits') && normalizedText.includes('heroic')) {
            await worker.setParameters({ tessedit_pageseg_mode: '11' });
            result = await worker.recognize(png, {}, { text: true, blocks: true });
            recognized = ocrItems(result, scale);
            if (isOfficialPositioned(recognized)) {
              candidate = emptyDraft();
              extractPositioned(candidate, recognized, pageNumber, 'ocr', result.data.confidence, true);
              await readOfficialRegions(worker, png, scale, candidate, pageNumber);
            }
          }
          // Also use original OCR lines, avoiding merged multi-column word rows.
          for (const line of result.data.text.split('\n')) {
            const match = line.match(/^(.{1,60}?)\s*:\s*(.+)$/);
            const key = match && fieldFor(match[1]);
            if (key) addEvidence(candidate, key, match[2], source(pageNumber, 'ocr', result.data.confidence));
          }
          const score = Object.values(candidate.fields).filter(f => f.value !== null).length * 100 + result.data.confidence;
          if (!best || score > best.score) best = { candidate, score };
          if (REQUIRED.filter(key => candidate.fields[key]?.value != null).length >= 10 || (!hasImage && result.data.confidence >= 85)) break;
        }
        for (const [key, field] of Object.entries(best.candidate.fields)) {
          // OCR fills gaps; it must not replace an existing machine-readable value
          // with a less reliable reading of the same rendered characters.
          if (draft.fields[key]?.value != null) continue;
          for (const entry of field.evidence) addEvidence(draft, key, entry.raw, entry);
        }
        draft.unknown.push(...best.candidate.unknown);
        draft.warnings.push(...best.candidate.warnings);
        draft.warnings.push('OCR was used. Check recognized values against your original sheet before approval.');
      }
      page.cleanup();
    }
    let retained = 0;
    draft.unknown = draft.unknown.filter(entry => { retained += entry.text.length; return retained <= 200000; });
    if (retained > 200000) draft.warnings.push('Source text exceeds the review limit. Some unstructured text was omitted; consult your original PDF.');
    return finishDraft(draft);
  } finally {
    if (worker) await worker.terminate();
    await loading.destroy();
  }
}
