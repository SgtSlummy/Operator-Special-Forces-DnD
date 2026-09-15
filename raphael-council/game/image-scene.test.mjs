import test from 'node:test';
import assert from 'node:assert/strict';
import { tacticalImageScene } from './image-scene.mjs';

test('tactical image scene carries only an approved owner portrait path for visible owned actors', () => {
  const view = { campaign: 'shore', revision: 3, round: 1, turn: 1,
    map: { id: 'shore-map', title: 'Saltglass Shore' },
    actors: [
      { id: 'hero', name: 'Mr. Mecha Cannibal', owner: '123456789012345678', x: 1, y: 2, defeated: false },
      { id: 'threat', name: 'Threat', owner: null, x: 4, y: 2, defeated: false },
    ], effects: [] };
  const scene = tacticalImageScene(view, { campaign: 'shore', owner: '123456789012345678' }, {
    resolvePortrait: owner => owner === '123456789012345678' ? 'C:/private/portraits/mr-mecha.png' : null,
  });
  assert.equal(scene.subjects[0].portraitPath, 'C:/private/portraits/mr-mecha.png');
  assert.equal(Object.hasOwn(scene.subjects[1], 'portraitPath'), true);
  assert.equal(scene.subjects[1].portraitPath, null);
});
