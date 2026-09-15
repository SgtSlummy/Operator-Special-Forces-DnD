import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { CharacterStore } from './store.mjs';
import { CharacterPortraitService } from './portrait-service.mjs';
import { emptyDraft, addEvidence } from './model.mjs';

const scope = { campaign: 'greyharbor', owner: '123456789012345678' };
function completeDraft() {
  const draft = emptyDraft();
  for (const [key, value] of Object.entries({ name: 'Maren', classes: 'Ranger 3', level: 3, strength: 12, dexterity: 16,
    constitution: 14, intelligence: 10, wisdom: 15, charisma: 8, armorClass: 15, maxHp: 28, currentHp: 19 })) {
    addEvidence(draft, key, value, { page: 1, method: 'form' });
  }
  return draft;
}

test('portrait service generates a validated local file for the approved revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'raphael-portrait-test-'));
  const store = new CharacterStore(':memory:');
  try {
    const job = store.createJob(scope, 'portrait');
    store.ready(job.id, scope, completeDraft(), 'hash');
    const review = store.job(job.id, scope);
    store.approve(job.id, scope, review.revision);
    const png = createCanvas(8, 8).toBuffer('image/png');
    const service = new CharacterPortraitService({ store, provider: async request => {
      assert.match(request.prompt, /simplified character portrait/);
      return png;
    }, dataDir: directory });
    const record = await service.generate(scope);
    assert.equal(record.status, 'ready');
    assert.equal(readFileSync(record.path).equals(png), true);
    assert.equal(store.portrait(scope).sha256.length, 64);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
