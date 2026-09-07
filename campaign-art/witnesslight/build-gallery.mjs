import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run with: node campaign-art/witnesslight/build-gallery.mjs
// The generated gallery opens directly from disk. No server or network is used.
const root = path.dirname(fileURLToPath(import.meta.url));
const collections = [
  { file: 'manifest.json', label: 'Campaign scenes' },
  { file: 'world/manifest.json', label: 'World & places' },
  { file: 'people/manifest.json', label: 'People & factions' },
  { file: 'lore/manifest.json', label: 'Lore & wonders' },
];
const catalog = [];
const titleCase = (value) => String(value).replace(/^\d+-/, '').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const textValue = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
const sceneCaption = (asset) => {
  const explicit = textValue(asset.caption, asset.description, asset.scene);
  if (explicit) return explicit;
  const prompt = textValue(asset.prompt);
  for (const marker of [
    'Depict an unresolved playable moment, never a predetermined victory, death or political choice. ',
    'including absolutely clean image corners. ',
  ]) {
    const index = prompt.indexOf(marker);
    if (index >= 0) return prompt.slice(index + marker.length).trim();
  }
  return textValue(asset.appearanceProposal, asset.continuity, asset.state);
};

for (const collection of collections) {
  const manifestPath = path.join(root, collection.file);
  let manifest;
  try {
    manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw new Error(`Cannot read ${collection.file}: ${error.message}`);
  }
  if (!Array.isArray(manifest.assets)) throw new Error(`${collection.file} must contain an assets array.`);
  for (const asset of manifest.assets) {
    if (asset.status !== 'generated') continue;
    if (typeof asset.file !== 'string' || !asset.file.trim()) throw new Error(`Missing image file for ${asset.id} in ${collection.file}.`);
    const imagePath = path.resolve(path.dirname(manifestPath), asset.file);
    const relativePath = path.relative(root, imagePath);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
      throw new Error(`Image path leaves the collection: ${asset.file}`);
    }
    await access(imagePath);
    const visibility = textValue(asset.visibility).toLowerCase();
    const normalizedPath = relativePath.replaceAll('\\', '/');
    const gm = /gm[ -]?spoiler|gm[ -]?only/.test(visibility) || normalizedPath.includes('gm-spoilers/');
    const conditional = /conditional/.test(visibility) || normalizedPath.includes('conditional/');
    const concept = asset.canonBasis === 'new-visual-concept' || normalizedPath.includes('new-visual-concept/');
    const discovery = /on[ -]discovery|portraits/.test(visibility);
    const category = gm ? 'GM spoiler' : conditional ? 'Conditional scene' : discovery ? 'Reveal after encounter' : visibility === 'opening' ? 'Opening scene' : 'Review before sharing';
    catalog.push({
      id: textValue(asset.id, relativePath),
      title: textValue(asset.title) || titleCase(asset.id || path.basename(asset.file, path.extname(asset.file))),
      collection: collection.label,
      category,
      caption: sceneCaption(asset),
      src: normalizedPath.split('/').map(encodeURIComponent).join('/'),
      gm, conditional, concept,
      appearanceProposal: Boolean(asset.appearanceProposal),
    });
  }
}

const serialized = JSON.stringify(catalog).replaceAll('<', '\\u003c');
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Witnesslight — Avarra image collection</title>
  <style>
    :root { color-scheme: dark; --bg:#10171d; --panel:#19232b; --edge:#35434d; --ink:#edf0ed; --muted:#b1bdc4; --accent:#e6b778; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .wrap { max-width:1640px; margin:auto; padding:clamp(20px,4vw,64px); }
    header { max-width:880px; margin:10px 0 36px; }
    .eyebrow { color:var(--accent); letter-spacing:.18em; text-transform:uppercase; font-size:.75rem; margin:0 0 10px; }
    h1 { margin:0; font:clamp(2.6rem,6vw,5rem)/1.1 Georgia,serif; font-weight:400; letter-spacing:-.025em; }
    .intro { color:var(--muted); max-width:680px; margin:20px 0 0; }
    a { color:var(--accent); }
    a:hover { color:#ffe0af; }
    .tools { display:flex; flex-wrap:wrap; gap:14px 20px; padding:24px; border:1px solid var(--edge); border-radius:8px; background:var(--panel); }
    .field { display:flex; flex-direction:column; gap:6px; min-width:190px; }
    .search { flex:1 1 340px; }
    label,legend { font-size:.88rem; color:var(--muted); }
    input[type="search"], select { width:100%; min-height:45px; border:1px solid #64747e; border-radius:4px; background:#10191f; color:var(--ink); padding:9px 12px; font:inherit; }
    select { cursor:pointer; }
    fieldset { border:0; padding:0; margin:0; min-width:230px; align-self:center; }
    legend { padding:0 0 7px; }
    .check { display:flex; align-items:center; gap:9px; cursor:pointer; min-height:29px; color:var(--ink); }
    input[type="checkbox"] { width:17px; height:17px; accent-color:var(--accent); margin:0; }
    :focus-visible { outline:3px solid var(--accent); outline-offset:4px; }
    .note { color:var(--muted); font-size:.84rem; margin:12px 0 22px; max-width:920px; }
    .results { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:8px; margin:28px 0 18px; }
    #count { margin:0; font-weight:500; }
    .hint { margin:0; color:var(--muted); font-size:.84rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr)); gap:28px 22px; }
    .card { overflow:hidden; border:1px solid var(--edge); border-radius:6px; background:var(--panel); }
    .image-link { display:block; background:#0b1116; overflow:hidden; }
    .image-link img { display:block; width:100%; height:auto; aspect-ratio:16/10; object-fit:contain; transition:transform .2s ease; }
    .image-link:hover img { transform:scale(1.025); }
    .body { padding:19px 20px 21px; }
    .collection { margin:0 0 7px; color:var(--accent); font-size:.73rem; letter-spacing:.09em; text-transform:uppercase; }
    h2 { font:1.36rem/1.35 Georgia,serif; margin:0 0 11px; font-weight:400; }
    h2 a { color:var(--ink); text-decoration:none; }
    h2 a:hover { text-decoration:underline; text-underline-offset:4px; }
    .tags { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; }
    .tag { font-size:.71rem; padding:2px 7px; border:1px solid #52616b; border-radius:3px; color:#d0d8dc; }
    .tag.caution { color:#f0c895; border-color:#89714f; }
    details { margin-top:10px; color:var(--muted); font-size:.86rem; }
    summary { cursor:pointer; color:#d4dde1; }
    details p { margin:8px 0 0; }
    .empty { padding:60px 24px; text-align:center; color:var(--muted); border:1px dashed var(--edge); border-radius:6px; }
    [hidden] { display:none !important; }
    footer { border-top:1px solid var(--edge); margin-top:44px; padding-top:19px; color:var(--muted); font-size:.8rem; }
    footer p { margin:4px 0; }
    @media (prefers-reduced-motion:reduce) { .image-link img { transition:none; } }
    @media (max-width:560px) { .tools { padding:18px; } .field { width:100%; } .grid { gap:20px; } }
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <p class="eyebrow">Avarra · Campaign art</p>
      <h1>Witnesslight</h1>
      <p class="intro">Explore the places, people, and mysteries of a living world. Dramatic light, believable materials, and detail reserved for the moments that matter.</p>
    </header>
    <form class="tools" id="filters" role="search" aria-label="Filter image collection">
      <div class="field search"><label for="search">Find an image</label><input id="search" type="search" placeholder="Search names, places, and descriptions…" autocomplete="off"></div>
      <div class="field"><label for="collection">Collection</label><select id="collection"><option value="">All collections</option></select></div>
      <fieldset><legend>Reveal options</legend><label class="check"><input id="gm" type="checkbox">Show GM spoilers</label><label class="check"><input id="conditional" type="checkbox">Show conditional scenes</label></fieldset>
    </form>
    <p class="note">Check party knowledge before sharing any image. GM spoilers and conditional scenes are hidden by default. These local viewing filters are a browsing convenience; this folder and its catalog are not a player access boundary.</p>
    <div class="results"><p id="count" role="status" aria-live="polite"></p><p class="hint">Select an image to open the full artwork.</p></div>
    <section class="grid" id="gallery" aria-label="Campaign image collection"></section>
    <p class="empty" id="empty" hidden>No images match these filters. Try another search or collection.</p>
    <noscript><p>Enable JavaScript to browse this local gallery, or open <a href="COLLECTION_INDEX.md">the collection index</a>.</p></noscript>
    <footer>
      <p>World concepts are proposals; exact distant geography remains unconfirmed. Conditional scenes do not record events that have happened in play.</p>
      <p>Open this file directly from disk. Images stay in their collection folders. This gallery does not update game state or automatically generate new artwork.</p>
    </footer>
  </main>
  <script type="application/json" id="catalog">${serialized}</script>
  <script>
    'use strict';
    const assets = JSON.parse(document.getElementById('catalog').textContent);
    const form = document.getElementById('filters');
    const search = document.getElementById('search');
    const collection = document.getElementById('collection');
    const gm = document.getElementById('gm');
    const conditional = document.getElementById('conditional');
    const gallery = document.getElementById('gallery');
    const count = document.getElementById('count');
    const empty = document.getElementById('empty');
    // Avoid restoring reveal checkboxes from previous browser sessions.
    gm.checked = false;
    conditional.checked = false;
    for (const name of [...new Set(assets.map((asset) => asset.collection))]) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      collection.append(option);
    }
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }
    function imageLink(asset) {
      const link = element('a', 'image-link');
      link.href = asset.src;
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('aria-label', 'Open full artwork: ' + asset.title);
      return link;
    }
    function card(asset) {
      const article = element('article', 'card');
      const link = imageLink(asset);
      const image = element('img');
      image.src = asset.src;
      image.alt = asset.title;
      image.loading = 'lazy';
      image.decoding = 'async';
      link.append(image);
      const body = element('div', 'body');
      body.append(element('p', 'collection', asset.collection));
      const title = element('h2');
      const titleLink = element('a', '', asset.title);
      titleLink.href = asset.src;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener';
      title.append(titleLink);
      const tags = element('div', 'tags');
      tags.append(element('span', 'tag' + (asset.gm || asset.conditional ? ' caution' : ''), asset.category));
      if (asset.concept) tags.append(element('span', 'tag caution', 'World concept · unconfirmed'));
      if (asset.appearanceProposal) tags.append(element('span', 'tag', 'Proposed appearance'));
      body.append(title, tags);
      if (asset.caption) {
        const details = element('details');
        details.append(element('summary', '', 'Scene description'), element('p', '', asset.caption));
        body.append(details);
      }
      article.append(link, body);
      return article;
    }
    function render() {
      const words = search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
      const revealed = assets.filter((asset) => (!asset.gm || gm.checked) && (!asset.conditional || conditional.checked));
      const matches = revealed.filter((asset) => {
        if (collection.value && asset.collection !== collection.value) return false;
        const haystack = [asset.title, asset.collection, asset.category, asset.caption, asset.concept ? 'world concept unconfirmed' : '', asset.appearanceProposal ? 'proposed appearance' : ''].join(' ').toLowerCase();
        return words.every((word) => haystack.includes(word));
      });
      const fragment = document.createDocumentFragment();
      for (const asset of matches) fragment.append(card(asset));
      gallery.replaceChildren(fragment);
      count.textContent = matches.length + ' of ' + assets.length + ' images' + (revealed.length < assets.length ? ' · ' + (assets.length - revealed.length) + ' hidden by reveal options' : '');
      empty.hidden = matches.length > 0;
    }
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('input', render);
    form.addEventListener('change', render);
    render();
  </script>
</body>
</html>
`;

const outputPath = path.join(root, 'gallery.html');
await writeFile(outputPath, html, 'utf8');
console.log(`Built ${outputPath} with ${catalog.length} generated images; all image files exist.`);
