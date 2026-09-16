import test from 'node:test';
import assert from 'node:assert/strict';
import { entryScreen } from './import-ui.mjs';

test('adventure desk exposes the configured campaign feed entry', () => {
  const payload = entryScreen('briar');
  const button = payload.components.flatMap(row => row.components || []).find(item => item.label === 'Campaign feed');
  assert.equal(button.custom_id, 'campaign:open:briar');
});
