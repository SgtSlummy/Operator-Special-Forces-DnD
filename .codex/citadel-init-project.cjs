'use strict';

const { spawnSync } = require('node:child_process');

const adapter = 'C:/Users/Hermes/.codex/plugins/cache/citadel-local/citadel/1.3.5/hooks_src/codex-adapter.js';
const input = require('node:fs').readFileSync(0, 'utf8');
const result = spawnSync(process.execPath, [adapter, 'init-project'], {
  cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  input,
  encoding: 'utf8',
  windowsHide: true,
});

if (result.error) {
  process.stderr.write(result.error.stack || String(result.error));
  process.exit(1);
}

if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

// Citadel v1.3.5 emits a human-readable status line after successful
// initialization. Codex SessionStart requires a JSON object, so preserve the
// successful side effects while returning an empty valid response.
process.stdout.write('{}\n');
