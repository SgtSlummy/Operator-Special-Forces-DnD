import { build, version as esbuildVersion } from 'esbuild';
import { isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(packageDir, '../..');
const output = join(packageDir, 'dist/index.mjs');
const allowedSources = new Set([
  'packages/chronicle/index.mjs',
  'discord/chronicle-core.mjs',
  'discord/chronicle-adapter.mjs',
  'chronicle/store.mjs',
  'chronicle/service.mjs',
  'chronicle/report.mjs',
  'chronicle/commands.mjs',
  'chronicle/dispatch.mjs',
]);
const slash = path => path.replaceAll('\\', '/');
const digest = value => createHash('sha256').update(value).digest('hex');
const knownBuiltin = path => isBuiltin(path);

// Fail closed on imports before writing a distributable artifact. In particular,
// importing the wrapper would pull in Operator platform and its voice defaults.
const result = await build({
  absWorkingDir: appDir,
  entryPoints: [join(packageDir, 'index.mjs')],
  outfile: output,
  bundle: true,
  platform: 'node',
  target: 'node22.16',
  format: 'esm',
  packages: 'external',
  external: ['@napi-rs/canvas'],
  metafile: true,
  write: false,
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const sources = Object.keys(result.metafile.inputs).map(slash).sort();
const unexpected = sources.filter(path => !allowedSources.has(path));
if (unexpected.length) throw new Error(`Forbidden chronicle bundle inputs: ${unexpected.join(', ')}`);
for (const required of allowedSources) if (!sources.includes(required)) throw new Error(`Missing required package input: ${required}`);
const imports = [...Object.values(result.metafile.inputs), ...Object.values(result.metafile.outputs)].flatMap(value => value.imports);
const externals = [...new Set(imports.filter(value => value.external).map(value => value.path))].sort();
const rejectedExternals = externals.filter(path => path !== '@napi-rs/canvas' && !knownBuiltin(path));
if (rejectedExternals.length) throw new Error(`Forbidden chronicle external dependencies: ${rejectedExternals.join(', ')}. All externals: ${externals.join(', ')}`);
const binary = result.outputFiles.find(file => resolve(file.path) === output);
if (!binary || result.outputFiles.length !== 1) throw new Error('Expected exactly one portable ESM bundle.');
const sourceHashes = {};
for (const path of sources) sourceHashes[path] = digest(await readFile(join(appDir, path)));
const manifest = {
  name: '@operator/chronicle', version: '0.1.1',
  esbuild: esbuildVersion, node: '>=22.16.0', dependencies: { '@napi-rs/canvas': '1.0.8' },
  entry: 'dist/index.mjs', sha256: digest(binary.contents), bytes: binary.contents.length,
  sources: sourceHashes, externals,
  exports: [...new Set(Object.values(result.metafile.outputs).flatMap(value => value.exports))].sort(),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, binary.contents);
await writeFile(join(packageDir, 'dist/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(packageDir, 'dist/metafile.json'), `${JSON.stringify(result.metafile, null, 2)}\n`);
console.log(JSON.stringify({ bundle: slash(relative(packageDir, output)), sha256: manifest.sha256, sources: sources.length, externals, bytes: manifest.bytes }));
