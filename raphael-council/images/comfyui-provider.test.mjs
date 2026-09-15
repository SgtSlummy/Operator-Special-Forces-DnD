import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceWorkflowPlaceholders } from './comfyui-provider.mjs';

test('workflow placeholders are replaced recursively without changing other values', () => {
  const result = replaceWorkflowPlaceholders({
    positive: '__RAPHAEL_PROMPT__',
    seed: '__RAPHAEL_SEED__',
    reference: '__RAPHAEL_REFERENCE__',
    nested: [{ value: '__RAPHAEL_PROMPT__' }],
    untouched: 42,
  }, 'simple portrait', 123, 'portrait.png');
  assert.deepEqual(result, { positive: 'simple portrait', seed: '123', reference: 'portrait.png', nested: [{ value: 'simple portrait' }], untouched: 42 });
});

