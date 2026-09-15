import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
class LaunchConfigurationError extends Error {}

function parseDotEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function protectedLaunchConfig({ projectRoot = root, inheritedEnv = process.env } = {}) {
const davyEnvPath = path.resolve(inheritedEnv.RAPHAEL_DAVY_ENV_FILE || path.resolve(projectRoot, '..', '..', 'Davy Jones', 'deployment', '.env'));
if (!fs.existsSync(davyEnvPath)) throw new LaunchConfigurationError('Protected Davy environment was not found. Check RAPHAEL_DAVY_ENV_FILE or the local Davy deployment folder.');

const localEnvPath = path.resolve(projectRoot, '.env.local');
const env = {
  ...inheritedEnv,
  ...(fs.existsSync(localEnvPath) ? parseDotEnv(fs.readFileSync(localEnvPath, 'utf8')) : {}),
  ...parseDotEnv(fs.readFileSync(davyEnvPath, 'utf8')),
};

// Raphael shares the existing Discord application. Keep the token and client
// secret in the protected Davy environment; only the browser-facing app ID is
// derived here. Never print the resulting environment.
env.DISCORD_CLIENT_ID ||= env.DISCORD_APPLICATION_ID || '';
env.RAPHAEL_GUILD_ID ||= env.DISCORD_TEST_GUILD_ID || '';
env.RAPHAEL_CAMPAIGN_ID ||= 'greyharbor';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'RAPHAEL_GUILD_ID', 'RAPHAEL_PLAYER_ROLE_ID'];
const missing = required.filter(key => !env[key]?.trim());
if (missing.length) {
  throw new LaunchConfigurationError(`Protected Raphael host configuration is incomplete. Configure these settings: ${missing.join(', ')}`);
}
const cli = path.join(projectRoot, 'node_modules', 'vinext', 'dist', 'cli.js');
if (!fs.existsSync(cli) || !fs.statSync(cli).isFile()) throw new LaunchConfigurationError('Vinext JavaScript launcher is missing. Install the application dependencies.');
return { cwd: projectRoot, env, cli };
}

export function launchProtected({ args = [], projectRoot = root, inheritedEnv = process.env,
  spawnImpl = spawn, lifecycle = process, stdio = 'inherit' } = {}) {
  const config = protectedLaunchConfig({ projectRoot, inheritedEnv });
  const child = spawnImpl(process.execPath, [config.cli, 'start', ...args], {
    cwd: config.cwd, env: config.env, stdio, windowsHide: true, shell: false,
  });
  let settled = false;
  const forwards = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
  const completion = new Promise(resolve => {
    const finish = (code, signal, failed = false) => {
      if (settled) return;
      settled = true;
      for (const [name, handler] of forwards) lifecycle.removeListener(name, handler);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      const exitCode = failed ? 1 : code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
      lifecycle.exitCode = exitCode;
      resolve({ exitCode, signal: signal ?? null, failed });
    };
    const onError = () => finish(null, null, true);
    const onExit = (code, signal) => finish(code, signal);
    child.once('error', onError);
    child.once('exit', onExit);
    for (const [name, handler] of forwards) lifecycle.on(name, handler);
  });
  return { child, completion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { completion } = launchProtected({ args: process.argv.slice(2) });
    const result = await completion;
    if (result.failed) console.error('Could not start Raphael web host.');
  } catch (error) {
    console.error(error instanceof LaunchConfigurationError ? error.message : 'Protected Raphael startup failed. Check access to its configuration and installed dependencies.');
    process.exitCode = 1;
  }
}
