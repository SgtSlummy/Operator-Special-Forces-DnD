import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const source = new URL('../scripts/obus-game.ps1', import.meta.url);
const powershell = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh';
const probe = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', windowsHide: true });
const skip = probe.error ? 'PowerShell is required for Windows launcher boundary fixtures.' : false;

// Invoke the real launcher with only OS/network boundaries replaced. No service,
// process termination, application token, or repository .env is used by fixtures.
const wrapper = String.raw`
$ErrorActionPreference = 'Stop'
$global:fixture = Get-Content -LiteralPath $env:RAPH_LAUNCHER_SCENARIO -Raw | ConvertFrom-Json
$global:events = @{ health = [Collections.Generic.List[object]]::new(); starts = [Collections.Generic.List[object]]::new(); stops = [Collections.Generic.List[object]]::new(); ports = [Collections.Generic.List[object]]::new(); processQueries = [Collections.Generic.List[object]]::new() }
$global:started = $false
$global:fixtureProcess = [pscustomobject]@{ ProcessId = 43210; ExecutablePath = $fixture.python; CommandLine = ('"' + $fixture.python + '" -m uvicorn backend.game_agent:app --host 127.0.0.1 --port ' + $fixture.processPort); CreationDate = [datetime]'2026-09-01T00:00:00Z' }
function Invoke-RestMethod {
    param($Uri, $Headers, $TimeoutSec, $MaximumRedirection)
    $events.health.Add(@{ uri = [string]$Uri; redirects = $MaximumRedirection; expectedToken = $Headers['X-Obus-Game-Token'] -ceq $fixture.expectedToken })
    if ($fixture.healthy -or ($started -and $fixture.startupHealthy)) { return @{ contract = 'raph-obus-game-v1'; codex_available = $false; remote_routes = $false } }
    throw 'Fixture endpoint unavailable.'
}
function Get-CimInstance {
    param($ClassName, $Filter, $ErrorAction)
    $events.processQueries.Add([string]$Filter)
    if ($Filter -like 'CommandLine LIKE*') { if ($fixture.otherAgent) { return $fixtureProcess }; return }
    if (-not $fixture.processAbsent) { return $fixtureProcess }
}
function Get-NetTCPConnection {
    param($State, $LocalPort, $ErrorAction)
    $events.ports.Add([int]$LocalPort)
    if ($fixture.occupied) { return @{ LocalPort = $LocalPort } }
}
function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError)
    $events.starts.Add(@{ python = $FilePath; arguments = $ArgumentList; root = $WorkingDirectory; window = $WindowStyle })
    $global:started = $true
    $fixtureProcess.CommandLine = '"' + $FilePath + '" ' + $ArgumentList
    $result = [pscustomobject]@{ Id = 43210; HasExited = $false }
    $result | Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
    return $result
}
function Stop-Process { param($Id, $ErrorAction); $events.stops.Add([int]$Id) }
function Start-Sleep { param($Milliseconds) }
$arguments = @{ Action = $fixture.action; ObusRoot = $fixture.obus; Python = $fixture.python }
if ($fixture.PSObject.Properties.Name -contains 'endpoint') { $arguments.Endpoint = $fixture.endpoint }
if ($fixture.PSObject.Properties.Name -contains 'tokenFile') { $arguments.TokenFile = $fixture.tokenFile }
$failure = $null
$output = @()
try { $output = @(& $fixture.script @arguments) } catch { $failure = $_.Exception.Message }
$receipt = if (Test-Path -LiteralPath $fixture.receiptPath) { Get-Content -LiteralPath $fixture.receiptPath -Raw | ConvertFrom-Json } else { $null }
@{ failure = $failure; output = $output; events = $events; receipt = $receipt } | ConvertTo-Json -Depth 8 -Compress
`;

async function run(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'raphael-launcher-'));
  try {
    const script = join(root, 'project', 'scripts', 'obus-game.ps1');
    const obus = join(root, 'obus');
    const python = join(root, 'python.exe');
    const profile = join(root, 'profile');
    const appData = join(root, 'appdata');
    const token = join(profile, '.occultbus', 'game-agent', 'service-token');
    const receiptPath = join(appData, 'Raphael', 'host', 'obus-game-process.json');
    for (const directory of [join(root, 'project', 'scripts'), join(obus, 'backend'), join(profile, '.occultbus', 'game-agent'), join(appData, 'Raphael', 'host')]) await mkdir(directory, { recursive: true });
    await writeFile(script, await readFile(source));
    await writeFile(join(obus, 'backend', 'game_agent.py'), '# fixture marker only\n');
    await writeFile(python, 'fixture executable marker only');
    await writeFile(token, 'a'.repeat(64));
    const environmentToken = join(root, 'environment-token');
    const explicitToken = join(root, 'explicit-token');
    await writeFile(environmentToken, 'b'.repeat(64));
    await writeFile(explicitToken, 'c'.repeat(64));
    const envText = typeof options.envText === 'function' ? options.envText({ token, environmentToken, explicitToken }) : options.envText ?? 'RAPHAEL_OBUS_URL=http://127.0.0.1:38176\n';
    await writeFile(join(root, 'project', '.env.local'), envText);
    const scenario = { action: 'start', healthy: false, startupHealthy: true, processPort: 38176, expectedToken: 'a'.repeat(64), ...options, script, obus, python, receiptPath };
    delete scenario.env;
    delete scenario.envText;
    delete scenario.receipt;
    if (options.tokenFile === 'explicit') scenario.tokenFile = explicitToken;
    if (options.receipt) {
      const receipt = { schema: 'raphael-obus-game-process-v2', processId: 43210, createdAt: '2026-09-01T00:00:00Z', endpoint: 'http://127.0.0.1:38176', obusRoot: resolve(obus), python: resolve(python), ...options.receipt };
      await writeFile(receiptPath, JSON.stringify(receipt));
    }
    await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario));
    await writeFile(join(root, 'wrapper.ps1'), wrapper);
    const env = { ...process.env, USERPROFILE: profile, LOCALAPPDATA: appData, RAPH_LAUNCHER_SCENARIO: join(root, 'scenario.json') };
    delete env.RAPHAEL_OBUS_URL;
    delete env.RAPHAEL_OBUS_TOKEN_FILE;
    delete env.OBUS_GAME_DATA_DIR;
    Object.assign(env, typeof options.env === 'function' ? options.env({ token, environmentToken, explicitToken }) : options.env);
    const execution = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', join(root, 'wrapper.ps1')], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(execution.status, 0, execution.stderr || String(execution.error));
    const result = JSON.parse(execution.stdout.trim());
    assert.ok(!execution.stdout.includes('a'.repeat(64)) && !execution.stdout.includes('b'.repeat(64)) && !execution.stdout.includes('c'.repeat(64)), 'tokens must not appear in output');
    return result;
  } finally {
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}raphael-launcher-`), 'cleanup stays in its dedicated temporary fixture directory');
    await rm(root, { recursive: true, force: true });
  }
}

function noProcessMutation(result) {
  assert.equal(result.events.starts.length, 0);
  assert.equal(result.events.stops.length, 0);
}

test('configured port 38176 controls health, bind, listener checks, receipt and startup message', { skip }, async () => {
  const result = await run();
  assert.equal(result.failure, null);
  assert.deepEqual(result.events.ports, [38176]);
  assert.equal(result.events.starts.length, 1);
  assert.equal(result.events.starts[0].arguments, '-m uvicorn backend.game_agent:app --host 127.0.0.1 --port 38176');
  assert.equal(result.events.starts[0].window, 'Hidden');
  assert.ok(result.events.health.every(item => item.uri === 'http://127.0.0.1:38176/api/game/capabilities' && item.redirects === 0 && item.expectedToken));
  assert.equal(result.receipt.endpoint, 'http://127.0.0.1:38176');
  assert.equal(result.receipt.schema, 'raphael-obus-game-process-v2');
  assert.match(result.output.join('\n'), /Started.*38176/);
});

test('endpoint precedence is explicit, ambient environment, .env.local, then legacy default', { skip }, async () => {
  for (const [options, expected] of [
    [{ endpoint: 'http://localhost:38201/', env: { RAPHAEL_OBUS_URL: 'http://127.0.0.1:38202' } }, 38201],
    [{ env: { RAPHAEL_OBUS_URL: 'http://127.0.0.1:38202' } }, 38202],
    [{ envText: 'RAPHAEL_OBUS_URL="http://localhost:38203" # literal setting\n' }, 38203],
    [{ envText: '# no endpoint configured\n' }, 38175],
    [{ endpoint: 'http://127.0.0.1:38204', envText: 'RAPHAEL_OBUS_URL="unused malformed lower-priority setting\n' }, 38204],
  ]) {
    const result = await run({ action: 'status', healthy: true, ...options });
    assert.equal(result.failure, null);
    assert.equal(JSON.parse(result.output.join('\n')).endpoint, `http://127.0.0.1:${expected}/api/game/capabilities`);
    noProcessMutation(result);
  }
});

test('remote, authenticated, redirected-path, malformed and invalid-port endpoints fail before any boundary call', { skip }, async () => {
  for (const endpoint of ['http://example.com:38176', 'https://127.0.0.1:38176', 'http://user:secret@127.0.0.1:38176', 'http://127.0.0.1:38176/api', 'http://127.0.0.1:38176/?q=1', 'http://127.0.0.1:38176/#x', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1', 'http://127.0.0.1:38176\n', 'http://[::1]:38176', '']) {
    const result = await run({ endpoint });
    assert.match(result.failure, /endpoint/i);
    assert.equal(result.events.health.length, 0);
    assert.equal(result.events.processQueries.length, 0);
    noProcessMutation(result);
  }
});

test('literal token-file settings follow precedence and unrelated .env content is not executed', { skip }, async () => {
  for (const options of [
    { envText: ({ environmentToken }) => `IGNORED=$(throw 'must never execute')\nRAPHAEL_OBUS_URL=http://127.0.0.1:38176\nRAPHAEL_OBUS_TOKEN_FILE='${environmentToken}'\n`, expectedToken: 'b'.repeat(64) },
    { env: ({ environmentToken }) => ({ RAPHAEL_OBUS_TOKEN_FILE: environmentToken }), expectedToken: 'b'.repeat(64) },
    { tokenFile: 'explicit', env: ({ environmentToken }) => ({ RAPHAEL_OBUS_TOKEN_FILE: environmentToken }), expectedToken: 'c'.repeat(64) },
  ]) {
    const result = await run({ action: 'status', healthy: true, ...options });
    assert.equal(result.failure, null);
    assert.equal(result.events.health[0].expectedToken, true);
    noProcessMutation(result);
  }
  const mismatch = await run({ tokenFile: 'explicit' });
  assert.match(mismatch.failure, /does not match the backend data directory/);
  noProcessMutation(mismatch);
});

test('healthy external service is reused and never stopped without an ownership receipt', { skip }, async () => {
  const start = await run({ healthy: true });
  assert.match(start.output.join('\n'), /Reusing.*38176/);
  noProcessMutation(start);
  const stop = await run({ action: 'stop', healthy: true });
  assert.match(stop.output.join('\n'), /outside this host command/);
  noProcessMutation(stop);
});

test('only matching endpoint, creation time, interpreter and backend ownership permit stop', { skip }, async () => {
  const owned = await run({ action: 'stop', healthy: true, receipt: {} });
  assert.equal(owned.failure, null);
  assert.deepEqual(owned.events.stops, [43210]);
  assert.equal(owned.receipt, null);
  for (const options of [
    { receipt: { endpoint: 'http://127.0.0.1:38175' } },
    { receipt: { createdAt: '2026-08-31T00:00:00Z' } },
    { receipt: { python: 'C:\\other\\python.exe' } },
    { receipt: { obusRoot: 'C:\\other\\obus' } },
    { receipt: { schema: 'legacy' } },
    { receipt: {}, processPort: 38175 },
    { receipt: {}, processAbsent: true },
  ]) {
    const result = await run({ action: 'stop', healthy: true, ...options });
    assert.equal(result.failure, null);
    noProcessMutation(result);
    assert.ok(result.receipt, 'unowned receipt must be retained');
  }
});

test('occupied port, unhealthy owned service and another game-agent process prevent duplicate startup', { skip }, async () => {
  for (const [options, message] of [
    [{ occupied: true }, /38176 is occupied/],
    [{ receipt: {} }, /starting or unhealthy/],
    [{ otherAgent: true, processPort: 38175, receipt: { endpoint: 'http://127.0.0.1:38175' } }, /existing Obus game-agent process/],
  ]) {
    const result = await run(options);
    assert.match(result.failure, message);
    noProcessMutation(result);
  }
});
