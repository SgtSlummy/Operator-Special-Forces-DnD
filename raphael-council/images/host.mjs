import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const mode = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'start'].includes(mode)) throw new Error('Choose dev, build or start.');
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vinext/dist/cli.js', import.meta.url)), mode, ...process.argv.slice(3)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, RAPHAEL_LOCAL_HOST: '1' }, stdio: 'inherit', windowsHide: true,
});
child.on('error', () => { console.error('Could not start the local game host.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
