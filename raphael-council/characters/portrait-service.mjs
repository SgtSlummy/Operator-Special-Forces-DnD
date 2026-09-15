import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { characterPortraitBrief } from './portrait.mjs';
import { validatePng } from '../images/provider.mjs';

const safePart = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';

/**
 * Generates and persists one portrait for an already-approved character revision.
 * The provider is injected so the same service works with Obus, ComfyUI, or tests.
 */
export class CharacterPortraitService {
  constructor({ store, provider, dataDir, now = Date.now } = {}) {
    if (!store || typeof store.character !== 'function' || typeof store.savePortrait !== 'function') throw new Error('A character store is required.');
    if (typeof provider !== 'function') throw Object.assign(new Error('Portrait generation is not configured.'), { code: 'PROVIDER_UNAVAILABLE' });
    if (typeof dataDir !== 'string' || !dataDir) throw new Error('A portrait data directory is required.');
    this.store = store;
    this.provider = provider;
    this.dataDir = resolve(dataDir);
    this.now = now;
  }

  async generate(scope, revision = null) {
    const character = this.store.character(scope);
    if (!character) throw new Error('Approve a character before generating a portrait.');
    const targetRevision = revision ?? character.revision;
    if (targetRevision !== character.revision) throw new Error('Portrait revision does not match the approved character.');
    const brief = characterPortraitBrief(character.snapshot);
    this.store.savePortrait(scope, targetRevision, { status: 'queued', prompt: brief.prompt, negativePrompt: brief.negativePrompt });
    try {
      const bytes = await validatePng(await this.provider({ prompt: brief.prompt, negativePrompt: brief.negativePrompt, references: [] }));
      const digest = createHash('sha256').update(bytes).digest('hex');
      const directory = join(this.dataDir, safePart(scope.campaign), safePart(scope.owner));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `revision-${targetRevision}-${digest}.png`);
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      return this.store.savePortrait(scope, targetRevision, {
        status: 'ready', prompt: brief.prompt, negativePrompt: brief.negativePrompt,
        sha256: digest, path, createdAt: this.now(),
      });
    } catch (error) {
      this.store.savePortrait(scope, targetRevision, {
        status: 'failed', prompt: brief.prompt, negativePrompt: brief.negativePrompt,
        error: error.code === 'PROVIDER_UNAVAILABLE' ? 'Portrait generation is unavailable.' : 'Portrait generation failed.',
      });
      throw error;
    }
  }
}
