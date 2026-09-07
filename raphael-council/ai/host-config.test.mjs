import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalObusHostControl } from './host-config.mjs';

const key = '1'.repeat(64);
function transport() { return { url: 'http://127.0.0.1:38175', headers: () => ({ 'X-Obus-Game-Token': 'a'.repeat(64) }) }; }
function directory(t) { const path = mkdtempSync(join(tmpdir(), 'operator-host-key-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }

test('explicit trusted configuration constructs an inert control with no network or process activity', () => {
  const control = createLocalObusHostControl({ transport: transport(), env: { RAPHAEL_OBUS_HOST_CONTROL_TOKEN: key } });
  assert.deepEqual(Object.keys(control).sort(), ['configure', 'getRuntime', 'register', 'renew', 'revoke']);
  assert.ok(Object.isFrozen(control));
});

test('host key file accepts only a bounded exact key and one optional terminal newline', t => {
  const path = join(directory(t), 'credential');
  for (const text of [key, key + '\n', key + '\r\n']) {
    writeFileSync(path, text);
    assert.equal(typeof createLocalObusHostControl({ transport: transport(), env: { RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE: path } }).register, 'function');
  }
  for (const text of ['', key.slice(1), key + '\n\n', ' ' + key, key.toUpperCase().replace('1', 'Z'), key + 'secret']) {
    writeFileSync(path, text);
    assert.throws(() => createLocalObusHostControl({ transport: transport(), env: { RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE: path } }), /private Obus game host credential/);
  }
});

test('exclusive sources, relative paths, directories and unsafe endpoints fail closed', t => {
  for (const env of [
    { RAPHAEL_OBUS_HOST_CONTROL_TOKEN: key, RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE: 'ignored' },
    { RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE: 'relative-key' },
    { RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE: directory(t) },
    { RAPHAEL_OBUS_HOST_CONTROL_TOKEN: '' },
  ]) assert.throws(() => createLocalObusHostControl({ transport: transport(), env }), /private Obus game host credential/);
  for (const url of ['http://localhost:38175', 'https://example.com', 'http://127.0.0.1:38175/other']) {
    assert.throws(() => createLocalObusHostControl({ transport: { ...transport(), url }, env: { RAPHAEL_OBUS_HOST_CONTROL_TOKEN: key } }), /private Obus game host credential/);
  }
});

test('configuration failures never disclose private credentials or file details', () => {
  const secret = 'sensitive fixture data';
  assert.throws(() => createLocalObusHostControl({ transport: { ...transport(), headers() { throw new Error(secret); } }, env: { RAPHAEL_OBUS_HOST_CONTROL_TOKEN: key } }), error => {
    assert.equal(error.message.includes(secret), false); assert.equal(error.message.includes(key), false); return true;
  });
});
