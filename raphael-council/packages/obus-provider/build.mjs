import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url)), appDir = resolve(root, '../..');
const expected = ['packages/obus-provider/index.mjs', 'ai/obus.mjs', 'chronicle/obus-provider.mjs'].sort();
const allowed = new Set(expected.map(path => resolve(appDir, path)));
const hash = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.dependencies && Object.keys(manifest.dependencies).length) throw new Error('Portable Obus provider must have no runtime packages.');
const result = await build({ absWorkingDir: root, entryPoints: ['index.mjs'], bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22.16', metafile: true, write: false, outfile: 'dist/index.mjs', sourcemap: false, legalComments: 'none', logLevel: 'warning' });
const inputs = Object.keys(result.metafile.inputs).map(path => resolve(root, path));
if (inputs.length !== allowed.size || inputs.some(path => !allowed.has(path))) throw new Error('Unexpected Obus provider bundle source.');
const externalImports = [...new Set([...Object.values(result.metafile.inputs), ...Object.values(result.metafile.outputs)].flatMap(value => value.imports).filter(value => value.external).map(value => value.path))].sort();
if (externalImports.some(path => !isBuiltin(path))) throw new Error('Unexpected Obus provider runtime dependency.');
if (result.outputFiles.length !== 1) throw new Error('Unexpected Obus provider artifact.');
const artifact = result.outputFiles[0].contents, sourceHashes = {};
for (const path of inputs.sort()) sourceHashes[relative(appDir, path).replaceAll('\\', '/')] = hash(await readFile(path));
const audit = { name: manifest.name, version: manifest.version, esbuild: esbuildVersion, node: manifest.engines.node,
  dependencies: {}, sources: sourceHashes, externalImports, bytes: artifact.length, sha256: hash(artifact),
  exports: [...new Set(Object.values(result.metafile.outputs).flatMap(value => value.exports))].sort() };
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/index.mjs'), artifact);
await writeFile(join(root, 'dist/audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
await writeFile(join(root, 'dist/metafile.json'), `${JSON.stringify(result.metafile, null, 2)}\n`);
console.log(JSON.stringify(audit));
