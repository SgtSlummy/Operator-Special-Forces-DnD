import './offline.mjs';
import { readFile } from 'node:fs/promises';
import { extractPdf } from './pdf.mjs';
process.once('message', async ({ path }) => {
  try {
    const draft = await extractPdf(await readFile(path), { onProgress: progress => process.send?.({ type: 'progress', progress }) });
    process.send?.({ type: 'done', draft }, () => process.exit(0));
  } catch {
    // Do not return arbitrary parser errors that may contain document content.
    process.send?.({ type: 'failed', error: 'Could not read this PDF safely. Check that it is unlocked, legible, and within the size/page limits.' }, () => process.exit(1));
  }
});
