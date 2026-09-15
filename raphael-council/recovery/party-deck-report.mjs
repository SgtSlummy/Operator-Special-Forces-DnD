import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountReplay } from './deck-ui/deck-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sessionRoot = resolve(process.env.RAPHAEL_PARTY_REPORT_DIR || join(root, 'tmp', 'party-session'));
const input = join(sessionRoot, 'session.json');
const output = join(sessionRoot, 'deck.html');
const data = JSON.parse(await readFile(input, 'utf8'));
const css = await readFile(new URL('./deck-ui/deck.css', import.meta.url), 'utf8');
const assets = new Set();
const missingAssets = [];
const requested = new Set(['images/portrait-branna.png', 'images/portrait-pip.png', 'images/portrait-kael.png', 'images/portrait-brine.png']);
for (const step of data.steps || []) {
  for (const reference of [step.areaMap, step.mainMap, step.worldMap]) {
    if (typeof reference?.imageFile === 'string') requested.add(reference.imageFile);
  }
  if (typeof step.imageFile === 'string') requested.add(step.imageFile);
  if (step.image?.approvedImage) requested.add('images/' + step.image.approvedImage + '.png');
  for (const path of Object.values(step.mapImages || {})) {
    if (typeof path === 'string') requested.add(path);
    else if (path && typeof path === 'object') for (const nested of Object.values(path)) if (typeof nested === 'string') requested.add(nested);
  }
}
for (const path of requested) {
  // Reuse the report's assets in place; never rewrite the shared session or images.
  const normalized = path.replaceAll('\\', '/');
  const source = resolve(sessionRoot, normalized);
  if (!normalized.startsWith('images/') || !source.startsWith(join(sessionRoot, 'images') + sep)) {
    missingAssets.push({ path, reason: 'Not a local session image path' });
    continue;
  }
  try { await access(source); assets.add(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missingAssets.push({ path, reason: 'Image not available in the current session' });
  }
}
const escJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Local DM replay preview</title>
<style>${css}</style>
</head>
<body>
<a href="#replay-content" class="skip">Skip to the map and scene</a>
<main>
  <header class="page-head"><h1 id="location-title">Session replay</h1><p>Local DM replay preview</p></header>
  <nav class="replay-nav" aria-label="Replay navigation">
    <button id="previous" type="button" aria-label="Previous replay moment">Previous</button>
    <span class="count" id="count"></span>
    <button id="next" type="button" aria-label="Next replay moment">Next</button>
  </nav>
  <p id="replay-status" class="visually-hidden" role="status" aria-atomic="true"></p>
  <p id="empty-session" class="empty" hidden>No moments were saved in this session. Generate the deck again when a session is available.</p>
  <div id="replay-content" tabindex="-1">
    <p id="display-warnings" class="display-warning" hidden></p>
    <section class="stage" aria-label="Recorded map, scene and action">
      <div id="map-stack" class="map-stack">
        <p id="map-status" class="visually-hidden" role="status" aria-atomic="true"></p>
        <details id="main-map-section" class="map-section">
          <summary>Main Map <span id="main-map-availability" class="map-state">Not charted yet</span></summary>
          <figure id="main-map-area" class="map-area overview-map">
            <div class="map-head"><button id="enlarge-main-map" type="button" aria-label="Enlarge main map" aria-expanded="false" aria-controls="main-map-link" disabled>Enlarge</button></div>
            <a class="map-link" id="main-map-link" aria-label="Open the full main map image" hidden><img id="main-map-image" alt="Main map" width="1280" height="872" loading="lazy" hidden></a>
            <p id="main-map-missing" class="empty">Not charted yet</p>
            <figcaption id="main-map-caption" class="map-caption"></figcaption>
          </figure>
        </details>
        <details id="area-map-section" class="map-section">
          <summary>Area Map <span id="area-map-availability" class="map-state"></span></summary>
          <figure id="area-map-area" class="map-area overview-map">
            <div class="map-head"><button id="enlarge-area-map" type="button" aria-label="Enlarge area map" aria-expanded="false" aria-controls="area-map-link" disabled>Enlarge</button></div>
            <a class="map-link" id="area-map-link" aria-label="Open the full area map image" hidden><img id="area-map-image" alt="Area map" width="1280" height="872" loading="lazy" hidden></a>
            <p id="area-map-missing" class="empty">Area Map unavailable: no map supplied.</p>
            <figcaption id="area-map-caption" class="map-caption"></figcaption>
          </figure>
        </details>
        <details id="battle-map-section" class="map-section">
          <summary>Battle Map <span id="battle-map-availability" class="map-state"></span></summary>
          <figure id="map-area" class="map-area">
            <div class="map-head"><button id="enlarge-map" type="button" aria-label="Enlarge battle map" aria-expanded="false" aria-controls="map-link" disabled>Enlarge</button></div>
            <a class="map-link" id="map-link" aria-label="Open the full saved DM battle map image" hidden><img id="map-image" alt="Saved DM battle map" width="960" height="916" fetchpriority="high" hidden></a>
            <p id="map-missing" class="empty">The saved battle map is unavailable for this moment.</p>
            <figcaption id="map-caption" class="map-caption"></figcaption>
          </figure>
        </details>
      </div>
      <div class="scene-record">
        <h2 class="action-heading" id="action-title"></h2>
        <p class="action-selection"><span class="action-badge"><span class="badge-state">Recorded</span> <strong id="selected-action"></strong></span></p>
        <figure>
          <img class="scene-image" id="scene-image" alt="Scene illustration" width="960" height="540" fetchpriority="high" hidden>
          <p id="scene-missing" class="empty" hidden>The scene illustration is unavailable. The recorded description is below.</p>
          <figcaption id="scene-caption" class="scene-caption"></figcaption>
        </figure>
        <section class="record" aria-labelledby="action-title">
          <p id="result-text" class="outcome" aria-label="Recorded outcome"></p>
          <div id="roll"></div>
        </section>
        <details id="scene-notes" hidden><summary>Scene notes</summary><p id="scene-copy" class="detail-body"></p></details>
      </div>
    </section>
    <details id="tactical">
      <summary>Map details and recorded positions</summary>
      <div class="detail-body">
        <label for="viewer-select">Map view</label><select id="viewer-select"></select>
        <p class="muted">This is a local DM preview. A safe player view requires a separate visibility-scoped snapshot; the exported encounter is not an authenticated player application.</p>
        <div id="battle-inspector">
          <label for="cell-select">Inspect a battle-map cell</label><select id="cell-select"></select>
          <div id="cell-details" aria-live="polite"></div>
        </div>
      </div>
    </details>
    <div class="columns">
      <section aria-labelledby="party-title">
        <h2 id="party-title">Party snapshot</h2><ul id="party" class="party"></ul>
        <details><summary>Actions shown in this replay</summary><div class="detail-body"><p class="muted">This is the saved action menu, not a set of live controls. The recorded action is shown above.</p><ul id="actions-list" class="actions-list"></ul></div></details>
      </section>
      <section aria-labelledby="draft-title">
        <h2 id="draft-title">Draft your next action</h2>
        <p class="draft-help">Keep a note for your DM. This replay cannot accept actions or change the session.</p>
        <form id="player-input">
          <label for="intent">What would you like to do?</label>
          <textarea id="intent" rows="4" maxlength="8000" placeholder="I inspect the brass seal before touching it." aria-describedby="input-status speech-help"></textarea>
          <div class="form-actions"><button class="primary" type="submit">Save local draft</button><button id="copy-draft" type="button">Copy draft</button></div>
          <p id="input-status" class="input-status" role="status" aria-atomic="true">Your draft stays here until you choose to copy it.</p>
        </form>
        <details class="speech-note"><summary>Using speech for your draft</summary><p id="speech-help" class="detail-body muted">This replay does not record audio or transcribe speech. You can use your device’s dictation in the text field, or paste a transcript. Review the words before saving or sharing.</p></details>
      </section>
    </div>
    <details class="history-controls"><summary>Jump to a recorded moment</summary><div class="detail-body"><label for="history-select">Replay history</label><select id="history-select"></select></div></details>
    <details class="admin">
      <summary>DM replay · Local diagnostics and admin</summary>
      <div class="detail-body">
        <p>This local diagnostic section can include hidden information. It is not a player permission boundary.</p>
        <details><summary>DM map and encounter roster</summary><div class="detail-body"><img id="admin-map" class="admin-image" alt="DM map" loading="lazy" hidden><ul id="admin-actors" class="party"></ul></div></details>
        <details><summary>Agent role activity</summary><div id="agents" class="detail-body"></div></details>
        <details><summary>Source details and revisions</summary><pre id="diagnostics" class="detail-body"></pre></details>
      </div>
    </details>
  </div>
  <footer>Local DM replay preview. This file contains encounter diagnostics and is not a player-safe export. Navigation and local drafts do not change the story.</footer>
  <noscript><p>This replay needs JavaScript for navigation. <a href="session.json">Read the saved session data</a>.</p></noscript>
</main>
<script>(${mountReplay.toString()})(${escJson(data)}, ${escJson([...assets])});</script>
</body>
</html>`;
await writeFile(output, html, 'utf8');
console.log(JSON.stringify({ output, steps: data.steps?.length || 0, availableImages: assets.size, missingAssets }, null, 2));
