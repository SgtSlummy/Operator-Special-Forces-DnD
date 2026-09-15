// Kept self-contained so the report can embed this function in a portable HTML file.
export function mountReplay(data, assets) {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const available = new Set(assets);
  const party = Array.isArray(data.party) ? data.party : [];
  const draftKey = 'party-deck:draft:' + (data.session || 'replay');
  const labels = { accept_characters: 'Accept characters', listen: 'Listen', move: 'Move', attack: 'Attack', end_turn: 'End turn', help_the_courier: 'Help the courier', decision: 'Carry the seal' };
  let current = 0;
  const enlarged = { main: false, area: false, battle: false };
  let viewer = 'admin';
  const mapPanels = [
    { scale: 'main', name: 'Main Map', prefix: 'main-map', figure: 'main-map-area', button: 'enlarge-main-map' },
    { scale: 'area', name: 'Area Map', prefix: 'area-map', figure: 'area-map-area', button: 'enlarge-area-map' },
    { scale: 'battle', name: 'Battle Map', prefix: 'map', figure: 'map-area', button: 'enlarge-map' }
  ];
  const failedImages = new Set();
  const words = value => String(value || '').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
  const actor = (step, id) => (step.actors || []).find(a => a.id === id);
  const actorName = (step, id) => actor(step, id)?.name || party.find(p => p.id === id)?.name || 'The character';
  const cell = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? String.fromCharCode(65 + p.x) + (p.y + 1) : 'an unrecorded position';
  const localImage = path => typeof path === 'string' && available.has(path) && !failedImages.has(path) ? path : '';
  const sceneImage = step => localImage(Object.hasOwn(step, 'imageFile') ? step.imageFile : 'images/' + step.image?.approvedImage + '.png');
  // Legacy player map paths are not evidence of a visibility-scoped snapshot.
  const mapImage = step => viewer === 'admin' ? localImage(step.mapImages?.admin) : viewer === 'adminTactical' ? localImage(step.mapImages?.adminTactical) : '';
  function mapTitle(step) {
    if (typeof step.mapScene === 'string') return step.mapScene;
    return step.mapScene?.title || step.mapScene?.label || (step.map?.id === step.location?.id ? step.location?.title : words(step.map?.id)) || 'Recorded map';
  }
  function warnings(step) {
    const items = Array.isArray(step.displayWarnings) ? step.displayWarnings : step.displayWarnings ? [step.displayWarnings] : [];
    const messages = items.map(item => typeof item === 'string' ? item : item.message || item.text || item.summary || '').filter(Boolean);
    if (!messages.length && step.map?.id && step.location?.id && step.map.id !== step.location.id) {
      messages.push('The scene is ' + step.location.title + ', but the map still shows ' + mapTitle(step) + '. No map transition is recorded.');
    }
    return messages;
  }
  function actionTitle(step) {
    const action = step.action || {};
    if (action.type === 'move') return actorName(step, action.actorId) + ' moves to ' + cell(action.path?.at(-1));
    if (action.type === 'attack') return actorName(step, action.actorId) + ' attacks';
    if (action.type === 'end_turn') return actorName(step, action.actorId) + ' ends the turn';
    if (action.type === 'decision') return action.choice || 'Make a decision';
    return labels[action.type] || words(action.type) || 'Recorded moment';
  }
  function resultText(step) {
    const action = step.action || {};
    const notes = step.notes || {};
    if (action.type === 'move') {
      const remaining = notes.result?.movementRemaining;
      if (notes.result?.stopped) return 'Movement stopped. ' + (remaining != null ? remaining + ' feet of movement remain.' : '');
      const cost = String(action.cost || '').match(/(\d+)\s*(?:feet|ft)/i)?.[1];
      const destination = actor(step, action.actorId) || action.path?.at(-1);
      return 'Reached ' + cell(destination) + (cost ? ' · ' + cost + ' ft spent' : '')
        + (remaining != null ? ' · ' + remaining + ' ft left' : '') + '.';
    }
    if (action.type === 'attack') {
      if (typeof action.roll?.hit !== 'boolean') return 'The attack was recorded; its outcome is unavailable.';
      return (action.roll.critical ? 'Critical hit' : action.roll.hit ? 'Hit' : 'Miss') + ' against ' + actorName(step, action.targetId) + (action.roll.damage != null ? ' for ' + action.roll.damage + ' damage' : '') + '.';
    }
    if (action.type === 'end_turn') return notes.result?.complete ? 'The recorded encounter is complete.' : 'The turn ended. The initiative order advances.';
    if (action.type === 'decision') return notes.worldChange ? words(notes.worldChange) + '.' : 'Decision recorded.';
    if (action.type === 'accept_characters') return 'The party is ready.';
    if (action.type === 'listen' && notes.visibleLeads?.length) return 'Noticed: ' + notes.visibleLeads.join(', ') + '.';
    return notes.consequence ? words(notes.consequence) + '.' : 'This moment was recorded without a separate outcome.';
  }
  function sceneText(step) {
    if (step.notes?.visibleLeads?.length) return 'In view: ' + step.notes.visibleLeads.join(', ') + '.';
    const description = step.location?.readAloud || step.readAloud || step.location?.description || '';
    // The current session also stores renderer instructions in description; keep those in diagnostics.
    const prose = description.split('\n').filter(line => !/^(Observable tactical scene:|Coordinates describe|Render only|Appearance is|Do not infer|Visible actors:|Visible effect zones:|Saved revision)/i.test(line.trim())).join(' ').trim();
    return prose;
  }
  function rollMarkup(step) {
    const roll = step.action?.roll;
    if (!roll) return '';
    const modifier = (roll.modifiers || []).reduce((total, m) => total + (Number(m.value) || 0), 0);
    const dice = (roll.dice || []).join(', ') || 'Not recorded';
    const total = roll.total ?? 'Not recorded';
    return '<p class="roll-summary" aria-label="Recorded roll"><span>d20 <strong>' + esc(dice) + '</strong> ' + (modifier >= 0 ? '+ ' : '− ') + esc(Math.abs(modifier)) + ' = <strong>' + esc(total) + '</strong></span>' + (roll.damage != null ? '<span>Damage <strong>' + esc(roll.damage) + '</strong></span>' : '') + (roll.weapon ? '<span class="muted">' + esc(roll.weapon) + '</span>' : '') + '</p>';
  }
  function portrait(id) {
    const key = String(id || '').startsWith('brine') ? 'brine' : id;
    const path = localImage('images/portrait-' + key + '.png');
    return path ? '<img class="portrait" src="' + esc(path) + '" alt="" width="54" height="64" loading="lazy">' : '';
  }
  function renderParty(step) {
    $('party').innerHTML = party.length ? party.map(person => {
      const state = actor(step, person.id);
      return '<li>' + portrait(person.id) + '<div><strong>' + esc(person.name) + '</strong><p>' + esc(person.ancestry) + ' ' + esc(person.className) + ' · Level ' + esc(person.level) + '</p><p>HP ' + esc(state?.hp ?? person.hp ?? 'Unknown') + ' · AC ' + esc(state?.ac ?? person.ac ?? 'Unknown') + (state?.coordinate ? ' · ' + esc(state.coordinate) : '') + '</p></div></li>';
    }).join('') : '<li>No party details were saved.</li>';
  }
  function mapCells(step) {
    const map = step?.map || {};
    const blocked = new Set((map.blocked || []).map(p => p.x + ',' + p.y));
    const difficult = new Set((map.difficult || []).map(p => p.x + ',' + p.y));
    const cells = [];
    for (let y = 0; y < (map.height || 0); y++) for (let x = 0; x < (map.width || 0); x++) {
      const key = x + ',' + y;
      cells.push({ label: cell({ x, y }), terrain: blocked.has(key) ? 'Solid rock · blocked' : difficult.has(key) ? 'Loose shingle · difficult' : 'Open ground', movement: blocked.has(key) ? 'Cannot enter' : difficult.has(key) ? 'Difficult terrain' : 'Normal movement' });
    }
    return cells;
  }
  function renderCell() {
    const selected = $('cell-select').value;
    const found = mapCells(steps[current]).find(item => item.label === selected);
    if (!found) { $('cell-details').innerHTML = '<p class="muted">Choose a cell to read its recorded terrain.</p>'; return; }
    const facts = [['Terrain', found.terrain], ['Movement', found.movement]];
    $('cell-details').innerHTML = '<dl class="facts">' + facts.map(([key, value]) => '<div><dt>' + esc(key) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>';
  }
  const mainReference = step => Object.hasOwn(step, 'mainMap') ? step.mainMap : step.worldMap;
  function overviewSource(step, reference, isMain = false) {
    // A saved image alone is not a state-bound map. Main owns discovery masking.
    if (!reference || !Number.isInteger(reference.gameRevision) || reference.gameRevision !== step.gameRevision) return '';
    const source = localImage(reference.imageFile);
    const normalized = path => String(path || '').replaceAll('\\', '/').toLowerCase();
    if (isMain && source && [step.areaMap?.imageFile, step.mapImages?.admin, step.mapImages?.adminTactical].some(path => path && normalized(path) === normalized(source))) return '';
    return source;
  }
  function defaultMapScale(step) {
    const type = String(step.action?.type || step.operation?.type || '').toLowerCase();
    const scope = String(step.action?.scope || step.operation?.scope || '').toLowerCase();
    const localTypes = ['move', 'attack', 'end_turn', 'endturn', 'listen', 'help_the_courier', 'rescue', 'local_rescue', 'investigate', 'local_investigate'];
    if (localTypes.includes(type)) return 'battle';
    const campaignTravel = ['campaign_travel', 'world_travel', 'travel_campaign', 'travel_world'].includes(type) || type === 'travel' && ['campaign', 'world', 'main'].includes(scope);
    if (campaignTravel && overviewSource(step, mainReference(step), true)) return 'main';
    return overviewSource(step, step.areaMap) ? 'area' : 'battle';
  }
  function resetMapSections(step) {
    const selected = defaultMapScale(step);
    for (const panel of mapPanels) {
      $(panel.scale + '-map-section').open = panel.scale === selected;
      enlarged[panel.scale] = false;
    }
  }
  function updateMap() {
    const step = steps[current];
    const isPlayer = viewer === 'player';
    for (const panel of mapPanels) {
      const isBattle = panel.scale === 'battle';
      const reference = panel.scale === 'main' ? mainReference(step) : step.areaMap;
      const source = isPlayer ? '' : isBattle ? mapImage(step) : overviewSource(step, reference, panel.scale === 'main');
      const label = isBattle ? mapTitle(step) : reference?.title || reference?.label || panel.name;
      const currentLocation = typeof reference?.currentLocation === 'string' ? reference.currentLocation : reference?.currentLocation?.title || reference?.currentLocation?.label || '';
      const image = $(panel.prefix + '-image');
      const link = $(panel.prefix + '-link');
      const missing = $(panel.prefix + '-missing');
      const button = $(panel.button);
      const caption = $(panel.prefix + '-caption');
      $(panel.scale + '-map-availability').textContent = isPlayer ? 'Player view unavailable' : source ? '' : panel.scale === 'main' && !reference ? 'Not charted yet' : 'Unavailable';
      missing.textContent = isPlayer ? 'Player view unavailable — visibility-scoped snapshot required'
        : isBattle ? 'The saved battle map is unavailable for this moment.'
        : !reference ? panel.scale === 'main' ? 'Not charted yet' : 'Area Map unavailable: no map supplied.'
        : reference.gameRevision !== step.gameRevision || !Number.isInteger(reference.gameRevision) ? panel.name + ' unavailable: no snapshot for this replay revision.'
        : panel.scale === 'main' && localImage(reference.imageFile) ? 'Not charted yet — an area or battle image is not a main map.'
        : panel.name + ' unavailable: supplied image is missing.';
      image.hidden = link.hidden = !source;
      missing.hidden = !!source;
      button.disabled = !source;
      caption.textContent = !source ? '' : isBattle ? label + (viewer === 'adminTactical' ? ' · DM tactical map' : ' · DM battle map') : panel.scale === 'area' ? 'Known locations · Not to scale' : label;
      if (source) {
        if (image.getAttribute('src') !== source) image.src = source;
        image.alt = isBattle ? 'Saved DM battle map of ' + label + '. Inspect a selected cell for its recorded terrain.'
          : (panel.scale === 'area' ? 'Area map of known campaign locations: ' : 'Main campaign map: ') + label + (currentLocation ? '. Current location: ' + currentLocation : '') + (panel.scale === 'area' ? '. Not to scale.' : '.') + (typeof reference?.description === 'string' && reference.description ? ' ' + reference.description : '');
        link.href = source;
      } else {
        image.removeAttribute('src');
        image.removeAttribute('alt');
        link.removeAttribute('href');
      }
      const expanded = enlarged[panel.scale] && !!source;
      $(panel.figure).classList.toggle('enlarged', expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? 'Fit map' : 'Enlarge';
      button.setAttribute('aria-label', (expanded ? 'Fit ' : 'Enlarge ') + panel.name.toLowerCase());
    }
    $('battle-inspector').hidden = isPlayer;
  }
  function render(announce = false) {
    const step = steps[current];
    if (!step) {
      $('location-title').textContent = 'No replay moments yet';
      $('replay-content').hidden = true;
      $('count').textContent = '0 of 0';
      $('previous').disabled = $('next').disabled = true;
      $('empty-session').hidden = false;
      return;
    }
    const title = mapTitle(step);
    const action = actionTitle(step);
    $('location-title').textContent = title;
    document.title = title + ' · Local DM replay preview';
    $('count').textContent = (current + 1) + ' of ' + steps.length;
    $('previous').disabled = current === 0;
    $('next').disabled = current === steps.length - 1;
    $('history-select').value = String(current);
    $('action-title').textContent = action;
    const recordedLabel = labels[step.action?.type] || words(step.action?.type);
    $('selected-action').textContent = (step.buttons || []).find(label => label.toLowerCase() === recordedLabel.toLowerCase()) || recordedLabel;
    $('result-text').textContent = resultText(step);
    $('roll').innerHTML = rollMarkup(step);
    $('scene-copy').textContent = sceneText(step);
    $('scene-notes').hidden = !$('scene-copy').textContent;
    const source = sceneImage(step);
    $('scene-image').hidden = !source;
    $('scene-missing').hidden = !!source;
    const sceneTitle = step.sceneImageTitle || title;
    if (source) { $('scene-image').src = source; $('scene-image').alt = 'Illustration of ' + sceneTitle; }
    else { $('scene-image').removeAttribute('src'); $('scene-image').removeAttribute('alt'); }
    $('scene-caption').textContent = sceneTitle + ' · Scene illustration';
    const notices = warnings(step);
    $('display-warnings').hidden = !notices.length;
    $('display-warnings').textContent = notices.join(' ');
    $('viewer-select').innerHTML = '<option value="admin">DM map · Local preview</option>' + (localImage(step.mapImages?.adminTactical) ? '<option value="adminTactical">DM tactical overlay</option>' : '') + '<option value="player">Player view · Unavailable</option>';
    if (viewer === 'adminTactical' && !localImage(step.mapImages?.adminTactical)) viewer = 'admin';
    $('viewer-select').value = viewer;
    resetMapSections(step);
    updateMap();
    renderParty(step);
    const cells = mapCells(step);
    $('cell-select').innerHTML = '<option value="">Choose a cell</option>' + cells.map(item => '<option value="' + esc(item.label) + '">' + esc(item.label) + ' · ' + esc(item.terrain) + '</option>').join('');
    $('cell-select').disabled = !cells.length;
    renderCell();
    $('actions-list').innerHTML = (step.buttons || []).map(item => '<li' + (item.toLowerCase() === (labels[step.action?.type] || '').toLowerCase() ? ' aria-current="true"' : '') + '>' + esc(item) + '</li>').join('') || '<li>No action menu was saved.</li>';
    $('agents').innerHTML = (step.agentProposals || []).map(proposal => '<article class="proposal"><h3>' + esc(proposal.label) + '</h3><span class="muted">' + esc(proposal.status) + '</span><p>' + esc(proposal.summary) + '</p></article>').join('') || '<p>No role diagnostics were saved.</p>';
    const adminMap = localImage(step.mapImages?.admin);
    $('admin-map').hidden = !adminMap;
    if (adminMap) { $('admin-map').src = adminMap; $('admin-map').alt = 'DM map of ' + mapTitle(step); }
    $('admin-actors').innerHTML = (step.actors || []).map(item => '<li>' + portrait(item.id) + '<div><strong>' + esc(item.name) + '</strong><p>' + esc(item.coordinate || cell(item)) + ' · HP ' + esc(item.hp ?? 'Unknown') + (item.maxHp != null ? '/' + esc(item.maxHp) : '') + (item.defeated ? ' · Defeated' : '') + '</p></div></li>').join('');
    $('diagnostics').textContent = JSON.stringify({ screen: step.screen, phase: step.phase, round: step.round, turn: step.turn, gameRevision: step.gameRevision, mapScene: step.mapScene, mapId: step.map?.id, locationId: step.location?.id, sceneRevision: step.sceneRevision, image: step.image, afterImage: step.afterImage, description: step.location?.description, rulesComponents: step.rulesComponents, recordedRoll: step.action?.roll, areaMap: step.areaMap, unverifiedTacticalMetadata: { status: 'Unverified agent metadata; not engine-validated terrain, cover, concealment or stairs', data: step.tactical } }, null, 2);
    if (announce) $('replay-status').textContent = 'Moment ' + (current + 1) + ' of ' + steps.length + '. ' + title + '. ' + action + '. ' + notices.join(' ');
  }
  function go(index) {
    if (index < 0 || index >= steps.length || index === current) return;
    current = index;
    render(true);
  }
  $('previous').addEventListener('click', () => go(current - 1));
  $('next').addEventListener('click', () => go(current + 1));
  $('history-select').innerHTML = steps.map((step, index) => '<option value="' + index + '">' + (index + 1) + '. ' + esc(actionTitle(step)) + ' · ' + esc(step.location?.title) + '</option>').join('');
  $('history-select').addEventListener('change', event => go(Number(event.target.value)));
  $('viewer-select').value = viewer;
  $('viewer-select').addEventListener('change', event => {
    viewer = event.target.value;
    updateMap();
    $('map-status').textContent = viewer === 'player' ? $('map-missing').textContent : 'Local DM map views restored.';
  });
  $('cell-select').addEventListener('change', renderCell);
  for (const panel of mapPanels) $(panel.button).addEventListener('click', () => {
    enlarged[panel.scale] = !enlarged[panel.scale];
    updateMap();
  });
  $('player-input').addEventListener('submit', event => {
    event.preventDefault();
    const draft = $('intent').value.trim();
    if (!draft) { $('input-status').textContent = 'Type an action before saving your local draft.'; $('intent').focus(); return; }
    try {
      localStorage.setItem(draftKey, draft);
      $('input-status').textContent = 'Draft saved in this browser. It has not been sent or added to the replay.';
    } catch { $('input-status').textContent = 'Browser storage is unavailable. Your draft is still here; copy it before closing this page.'; }
  });
  $('intent').addEventListener('input', () => { $('input-status').textContent = 'Unsaved local draft. Save it here or copy it for your DM.'; });
  $('copy-draft').addEventListener('click', async () => {
    const draft = $('intent').value.trim();
    if (!draft) { $('input-status').textContent = 'Type an action before copying.'; $('intent').focus(); return; }
    try { await navigator.clipboard.writeText(draft); $('input-status').textContent = 'Draft copied. Paste it where you contact your DM.'; }
    catch { $('intent').focus(); $('intent').select(); $('input-status').textContent = 'Clipboard access is unavailable. Your draft is selected; use your device’s Copy command.'; }
  });
  try {
    const saved = localStorage.getItem(draftKey);
    if (saved) { $('intent').value = saved; $('input-status').textContent = 'Saved local draft restored. It has not been sent or added to the replay.'; }
  } catch { $('input-status').textContent = 'Browser storage is unavailable. Copy your draft before closing this page.'; }
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    image.hidden = true;
    const panel = mapPanels.find(item => image.id === item.prefix + '-image');
    if (panel) {
      failedImages.add(image.getAttribute('src'));
      updateMap();
      $('map-status').textContent = $(panel.prefix + '-missing').textContent;
    }
    if (image.id === 'scene-image') $('scene-missing').hidden = false;
  }, true);
  render();
}
