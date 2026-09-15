import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';

// Run from raphael-council after party-deck-report.mjs. Browser checks use a fresh isolated context.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DECK_PLAYWRIGHT_MODULE || 'playwright');
for (const file of ['recovery/party-deck-report.mjs', 'recovery/deck-ui/deck-client.mjs']) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
}
const deck = resolve('tmp/party-session/deck.html');
const originalSession = await readFile('tmp/party-session/session.json', 'utf8');
const data = JSON.parse(originalSession);
const html = await readFile(deck, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1);
new Script(scripts[0][1], { filename: 'deck-embedded.js' });
const artifacts = resolve('tmp/party-session/deck-ui-checks');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { syntax: 'pass', viewports: [], interactions: [] };
try {
  for (const width of [320, 736, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(deck).href);
    await page.locator('#map-image').waitFor({ state: 'visible' });
    await page.locator('#map-image').evaluate(image => image.decode());
    await page.locator('#scene-image').evaluate(image => image.decode());
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mapTop: document.getElementById('map-image').getBoundingClientRect().top,
      sceneTop: document.getElementById('scene-image').getBoundingClientRect().top,
      adminClosed: !document.querySelector('.admin').open,
      tacticalClosed: !document.getElementById('tactical').open
    }));
    assert(dimensions.scrollWidth <= width, 'Page overflow at ' + width);
    assert(dimensions.mapTop < 800 && dimensions.sceneTop < 800, 'Map and scene must lead at ' + width);
    assert(dimensions.adminClosed && dimensions.tacticalClosed);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ text: document.activeElement.textContent, outline: getComputedStyle(document.activeElement).outlineWidth }));
    assert.equal(focus.outline, '3px');
    assert.match(focus.text, /Skip/);
    await page.locator('#next').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#count').textContent(), '2 of ' + data.steps.length);
    await page.locator('#previous').click();
    assert.equal(await page.locator('#count').textContent(), '1 of ' + data.steps.length);
    assert.equal(await page.locator('#previous').isDisabled(), true);
    await page.locator('#enlarge-map').click();
    assert.equal(await page.locator('#enlarge-map').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#enlarge-map').click();
    await page.locator('#tactical > summary').click();
    await page.locator('#viewer-select').selectOption('player');
    assert.equal(await page.locator('#map-missing').textContent(), 'Player view unavailable — visibility-scoped snapshot required');
    assert.equal(await page.locator('#map-link').isVisible(), false);
    assert.equal(await page.locator('#map-image').getAttribute('src'), null);
    await page.locator('#viewer-select').selectOption('admin');
    const overlay = await page.locator('#viewer-select option[value="adminTactical"]').count();
    if (overlay) {
      await page.locator('#viewer-select').selectOption('adminTactical');
      assert.equal(await page.locator('#map-image').getAttribute('src'), data.steps[0].mapImages.adminTactical);
      await page.locator('#viewer-select').selectOption('admin');
    }
    for (const [coordinate, expected] of [['B1', 'Open ground'], ['C1', 'Open ground'], ['D3', 'Solid rock · blocked'], ['D5', 'Solid rock · blocked'], ['C2', 'Loose shingle · difficult'], ['C4', 'Loose shingle · difficult'], ['C6', 'Loose shingle · difficult']]) {
      await page.locator('#cell-select').selectOption(coordinate);
      assert.match(await page.locator('#cell-details').textContent(), new RegExp(expected));
      assert.doesNotMatch(await page.locator('#cell-details').textContent(), /cover|stairs|concealment/i);
    }
    await page.locator('#tactical > summary').click();
    await page.locator('.history-controls > summary').click();
    const attackIndex = data.steps.findIndex(step => step.action.type === 'attack');
    await page.locator('#history-select').selectOption(String(attackIndex));
    assert.match(await page.locator('#roll').textContent(), /d20.*20.*25.*Damage.*19/s);
    assert.match(await page.locator('#result-text').textContent(), /Critical hit/);
    assert.equal(await page.locator('#legend').count(), 0);
    assert.equal(await page.locator('#selected-action').textContent(), 'Attack');
    assert.match(await page.locator('#action-title').textContent(), /attacks/);
    const last = data.steps.length - 1;
    await page.locator('#history-select').selectOption(String(last));
    assert.equal(await page.locator('#next').isDisabled(), true);
    assert.equal(await page.locator('#location-title').textContent(), data.steps[last].mapScene.title);
    if (data.steps[last].displayWarnings?.length) assert.equal(await page.locator('#display-warnings').isVisible(), true);
    await page.locator('#history-select').selectOption('0');
    await page.locator('.history-controls > summary').click();
    await page.locator('#intent').fill('I inspect the brass seal.');
    await page.locator('#player-input button[type="submit"]').click();
    assert.match(await page.locator('#input-status').textContent(), /Draft saved in this browser/);
    await page.reload();
    assert.equal(await page.locator('#intent').inputValue(), 'I inspect the brass seal.');
    // Clipboard failure must preserve the text and explain the manual Copy fallback.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked for test')) }, configurable: true }));
    await page.locator('#copy-draft').click();
    assert.match(await page.locator('#input-status').textContent(), /draft is selected/);
    assert.equal(await page.locator('#intent').inputValue(), 'I inspect the brass seal.');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve(artifacts, 'deck-' + width + '.png'), fullPage: true });
    assert.deepEqual(errors, []);
    report.viewports.push({ width, ...dimensions, pageErrors: errors.length });
    await page.close();
  }
  assert.equal(await readFile('tmp/party-session/session.json', 'utf8'), originalSession, 'UI verification must not modify the session');
  report.interactions = ['keyboard focus and Enter navigation', 'Previous/Next boundaries', 'history selection', 'map enlargement without page overflow', 'player view denied without admin fallback', 'optional DM tactical overlay', 'cell detail selection', 'selected attack and roll', 'scene/map warning', 'draft save/restore', 'clipboard failure fallback', 'session unchanged'];
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
