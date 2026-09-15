export function mountRehearsal(pack, api) {
  const root = document.getElementById('undertow-room-scale');
  const choice = root.querySelector('#undertow-room-choice');
  const floor = root.querySelector('#undertow-floor');
  const detail = root.querySelector('#undertow-room-detail');
  const caption = floor.nextElementSibling;
  const storageKey = `undertow-rehearsal:${pack.id}:${pack.revision}`;
  let state = api.newSession(pack), browse = false, atlasRoom = 'R01', storageAvailable = true;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label, action) => {
    const node = element('button', label, 'btn'); node.type = 'button'; node.addEventListener('click', action); return node;
  };
  const notify = (text, error = false) => {
    status.textContent = text; status.className = error ? 'text-destructive' : 'text-small text-muted';
  };
  const status = element('p', '', 'text-small text-muted'); status.setAttribute('role', 'status');
  const intro = element('p', 'Local GM rehearsal · explore the passages and keep a rehearsal save. Rules, hazards, combat and special crossings still need a GM ruling.', 'text-small text-muted');
  root.insertBefore(intro, root.children[1]);
  const heading = element('h3'); heading.id = 'undertow-current-room';
  const arrival = element('p'); arrival.className = 'undertow-arrival';
  const controls = element('div', undefined, 'viz-row');
  const mode = button('Browse atlas', () => { browse = !browse; atlasRoom = state.roomId === 'surface' ? 'R01' : state.roomId; render(); });
  const inspect = button('Investigate room', () => { state = api.inspectRoom(pack, state); persist(); render(); notify('Room details opened. Apply the authored rulings at the table.'); });
  controls.append(mode, inspect);
  const visitCount = element('span', '', 'text-small text-muted tabular-nums'); controls.append(visitCount);
  const notes = element('details'); const notesTitle = element('summary', 'GM notes'); const notesBody = element('div'); notes.append(notesTitle, notesBody);
  const routes = element('section'); routes.setAttribute('aria-label', 'Available passages');
  const routeTitle = element('h3', 'Choose a passage'); const routeList = element('div', undefined, 'undertow-routes');
  const boundary = element('p', '', 'text-small'); routes.append(routeTitle, routeList, boundary);
  const journal = element('details'); const journalTitle = element('summary', 'Journey'); const journalList = element('ol'); journal.append(journalTitle, journalList);
  const saves = element('details'); saves.append(element('summary', 'Save or restore a rehearsal'));
  const saveHint = element('p', 'Keep a copy before changing devices. Paste a saved rehearsal below to restore it.', 'text-small text-muted');
  const saveLabel = element('label', 'Rehearsal save', 'form-label'); saveLabel.htmlFor = 'undertow-save';
  const saveText = element('textarea', undefined, 'form-control'); saveText.id = 'undertow-save'; saveText.rows = 5; saveText.spellcheck = false; saveText.maxLength = 32000;
  const saveActions = element('div', undefined, 'viz-row');
  saveActions.append(button('Prepare save', () => { saveText.value = JSON.stringify(state, null, 2); notify('Save prepared. Copy the text somewhere safe.'); }),
    button('Restore save', () => {
      try {
        if (saveText.value.length > 32000) throw new Error('This save is too large.');
        const restored = api.restoreSession(pack, JSON.parse(saveText.value));
        state = restored; browse = false; persist(); render(); notify('Rehearsal restored.');
      } catch (error) {
        const message = error instanceof SyntaxError ? 'Paste the complete rehearsal save and try again.' : error.message;
        notify(`Could not restore: ${message} Your current rehearsal is unchanged.`, true);
      }
    }));
  const restart = button('Start a new rehearsal', () => {
    restart.hidden = true; confirmRestart.hidden = false; cancelRestart.hidden = false;
    notify('Starting again clears this rehearsal. Prepare a save first if you want to keep it.');
  });
  const confirmRestart = button('Confirm new rehearsal', () => {
    state = api.newSession(pack); browse = false; persist(); render(); restart.hidden = false; confirmRestart.hidden = true; cancelRestart.hidden = true;
    notify('New rehearsal started at the Brass Vestibule.');
  });
  const cancelRestart = button('Keep current rehearsal', () => { restart.hidden = false; confirmRestart.hidden = true; cancelRestart.hidden = true; notify('Current rehearsal kept.'); });
  confirmRestart.hidden = true; cancelRestart.hidden = true;
  const restartActions = element('div', undefined, 'viz-row'); restartActions.append(restart, confirmRestart, cancelRestart);
  saves.append(saveHint, saveLabel, saveText, saveActions, restartActions);
  root.append(heading, arrival, controls, status, notes, routes, journal, saves);
  root.querySelector('label[for="undertow-room-choice"]').firstChild.textContent = 'Room atlas ';
  choice.addEventListener('change', () => { if (browse) { atlasRoom = pack.rooms[Number(choice.value)].id; render(false); } });
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); storageAvailable = true; }
    catch { storageAvailable = false; }
  }
  function name(id) { return id === 'surface' ? 'Waterfront · surface' : `${id} · ${pack.rooms.find(room => room.id === id).name}`; }
  function render(redraw = true) {
    const id = browse ? atlasRoom : state.roomId;
    const room = pack.rooms.find(item => item.id === id);
    choice.disabled = !browse;
    if (room && redraw) { choice.value = String(pack.rooms.indexOf(room)); choice.dispatchEvent(new Event('change')); }
    floor.toggleAttribute('hidden', !room); detail.hidden = !room; caption.hidden = !room;
    choice.closest('.viz-controls').hidden = !room;
    heading.textContent = name(id); arrival.textContent = room?.reveal ?? 'You emerge at the waterfront. The maintenance entry and the signal tower both lead back into the Works.';
    mode.textContent = browse ? 'Return to journey' : 'Browse atlas'; mode.setAttribute('aria-pressed', String(browse));
    inspect.hidden = browse || !room; inspect.disabled = state.inspected.includes(id);
    inspect.textContent = state.inspected.includes(id) ? 'Room investigated' : 'Investigate room';
    visitCount.textContent = `${state.visited.filter(value => value !== 'surface').length} of 18 rooms visited`;
    notes.hidden = !room || (!browse && !state.inspected.includes(id)); notesBody.replaceChildren();
    for (const note of room?.notes ?? []) { const p = element('p'); p.append(element('strong', `${note.label}: `), document.createTextNode(note.text)); notesBody.append(p); }
    routeList.replaceChildren(); routeTitle.textContent = browse ? 'Connected passages · atlas only' : 'Choose a passage';
    for (const route of api.exits(pack, id)) {
      const row = element('div', undefined, 'undertow-route');
      const go = button(name(route.destination), () => {
        if (browse) {
          if (route.destination === 'surface') { notify('The surface connects the maintenance entrance and signal tower.'); return; }
          atlasRoom = route.destination; render(); return;
        }
        try { state = api.travel(pack, state, route.destination); persist(); render(); heading.scrollIntoView({ block: 'nearest', behavior: 'auto' }); notify(storageAvailable ? `Arrived at ${name(state.roomId)}. Saved on this browser.` : `Arrived at ${name(state.roomId)}. Browser saving is unavailable; use Prepare save.`); }
        catch (error) { notify(error.message, true); }
      });
      row.append(go, element('p', `${route.passage} · ${route.detail}`, 'text-small text-muted')); routeList.append(row);
    }
    boundary.textContent = pack.boundaries.filter(item => item.from === id).map(item => `${item.name}: ${item.detail}. This rehearsal does not automatically open the crossing.`).join(' ');
    boundary.hidden = !boundary.textContent;
    journalTitle.textContent = `Journey · ${state.moves} passages taken`; journalList.replaceChildren();
    for (const step of state.journal) journalList.append(element('li', `${name(step.from)} → ${name(step.to)}`));
    if (!state.journal.length) journalList.append(element('li', 'Your journey starts at the Brass Vestibule.'));
    journalList.start = Math.max(1, state.moves - state.journal.length + 1);
  }
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) { state = api.restoreSession(pack, JSON.parse(saved)); notify('Your last rehearsal has been restored.'); }
    else notify('Start at the Brass Vestibule, or browse the full atlas.');
  } catch { storageAvailable = false; notify('Browser saving is unavailable or the previous save is invalid. Use Prepare save to keep progress.'); }
  render();
}
