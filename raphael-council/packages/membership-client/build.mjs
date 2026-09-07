import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// A single import-free source module is the complete runtime artifact.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = await readFile(new URL('../../bridge/client.mjs', import.meta.url));
if (/\b(?:import|require)\s*(?:\(|[{*"'])/.test(source.toString())) throw new Error('Membership client unexpectedly gained a runtime import.');
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'client.mjs'), source);
console.log(JSON.stringify({ file: 'dist/client.mjs', bytes: source.length, sha256: createHash('sha256').update(source).digest('hex'), runtimeDependencies: [] }));
