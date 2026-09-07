import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile), packageDir = dirname(fileURLToPath(import.meta.url)), npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script with npm run pack:artifact.');
const audit = JSON.parse(await readFile(join(packageDir, 'dist/audit.json'), 'utf8'));
const packageManifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
if (packageManifest.version !== audit.version || hash(await readFile(join(packageDir, 'dist/index.mjs'))) !== audit.sha256) throw new Error('Package or bundle differs from build audit.');
for (const [path, expected] of Object.entries(audit.sources)) if (hash(await readFile(join(packageDir, '../..', path))) !== expected) throw new Error(`Source changed since build: ${path}`);
const destination = join(packageDir, 'artifacts'); await mkdir(destination, { recursive: true });
const expectedFilename = `operator-obus-chronicle-provider-${packageManifest.version}.tgz`;
let exists = false;
try { await access(join(destination, expectedFilename)); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (exists) throw new Error('Refusing to overwrite an existing immutable provider tarball.');
const { stdout } = await run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd: packageDir, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
const packing = JSON.parse(stdout), packed = Array.isArray(packing) ? packing[0] : packing[packageManifest.name];
if (packed?.name !== packageManifest.name || packed.filename !== expectedFilename || packed.version !== packageManifest.version) throw new Error('Unexpected packed provider identity.');
const payload = packed.files.map(file => file.path).sort();
if (JSON.stringify(payload) !== JSON.stringify(['README.md', 'dist/index.mjs', 'package.json'])) throw new Error('Unexpected provider payload.');
const manifest = { name: packed.name, version: packed.version, filename: packed.filename,
  sha256: hash(await readFile(join(destination, packed.filename))), npmIntegrity: packed.integrity,
  bytes: packed.size, unpackedBytes: packed.unpackedSize, bundleSha256: audit.sha256,
  node: audit.node, dependencies: {}, exports: audit.exports,
  files: packed.files.map(({ path, size, mode }) => ({ path, size, mode })) };
await writeFile(join(destination, `manifest-${packed.version}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
