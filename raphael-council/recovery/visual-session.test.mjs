import test from 'node:test';
import assert from 'node:assert/strict';
import { runVisualSession } from './visual-session.mjs';

test('visual solo session advances exploration, difficult movement, combat and images by revision', async () => {
  const result = await runVisualSession();
  assert.equal(result.steps.length, 5);
  assert.deepEqual(result.steps.map(step => step.image.status), ['ready', 'ready', 'ready', 'ready', 'ready']);
  assert.deepEqual(result.steps.map(step => step.sceneRevision), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.steps.map(step => step.image.approvedImage), ['11-saltglass-shore', '11-saltglass-shore', '11-saltglass-shore', '12-drowned-abbey', '12-drowned-abbey']);
  assert.equal(result.steps[1].action.cost.includes('difficult terrain'), true);
  assert.equal(result.steps[2].action.roll.critical, true);
  assert.equal(result.steps[2].actors.find(actor => actor.id === 'saltglass-sentinel').defeated, true);
  assert.equal(result.steps[3].location.title, 'Abbey Archive');
  assert.equal(result.steps[4].action.choice, 'Carry the seal into the records room');
  assert.equal(result.checkpoint.resumable, true);
});
