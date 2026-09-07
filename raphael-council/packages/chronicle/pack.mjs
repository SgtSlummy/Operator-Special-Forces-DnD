import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const packageDir = dirname(fileURLToPath(import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script with npm run pack:artifact.');
const audit = JSON.parse(await readFile(join(packageDir, 'dist/build-manifest.json'), 'utf8'));
const bundle = await readFile(join(packageDir, 'dist/index.mjs'));
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(bundle) !== audit.sha256) throw new Error('Bundle differs from its build audit. Run npm run build.');
for (const [path, expected] of Object.entries(audit.sources)) {
  if (hash(await readFile(join(packageDir, '../..', path))) !== expected) throw new Error(`Source changed since build: ${path}`);
}
const destination = join(packageDir, 'artifacts');
await mkdir(destination, { recursive: true });
const packageManifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
if (packageManifest.version !== audit.version) throw new Error('Package version differs from build audit.');
const expectedFilename = `operator-chronicle-${packageManifest.version}.tgz`;
let exists = false;
try { await access(join(destination, expectedFilename)); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (exists) throw new Error('Refusing to overwrite an existing immutable chronicle tarball.');
if (hash(await readFile(join(destination, 'operator-chronicle-0.1.0.tgz'))) !== '5b7f032a1ddedbc9f30ac65a256f319a985059860250b96de192b20327c375c6') throw new Error('The preserved chronicle 0.1.0 artifact is missing or changed.');
const { stdout } = await run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
  cwd: packageDir, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true,
});
const packing = JSON.parse(stdout);
const packed = Array.isArray(packing) ? packing[0] : packing['@operator/chronicle'];
if (packed?.name !== '@operator/chronicle' || packed.filename !== expectedFilename || packed.version !== packageManifest.version) throw new Error('npm did not return the expected package.');
const payload = packed.files.map(file => file.path).sort();
if (JSON.stringify(payload) !== JSON.stringify(['README.md', 'dist/index.mjs', 'package.json'])) throw new Error(`Unexpected tarball payload: ${payload.join(', ')}`);
const archive = join(destination, packed.filename);
const manifest = {
  name: packed.name, version: packed.version, filename: packed.filename,
  sha256: hash(await readFile(archive)), npmIntegrity: packed.integrity,
  bytes: packed.size, unpackedBytes: packed.unpackedSize,
  bundleSha256: audit.sha256, node: audit.node, dependencies: audit.dependencies,
  files: packed.files.map(({ path, size, mode }) => ({ path, size, mode })),
};
await writeFile(join(destination, `manifest-${packed.version}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
