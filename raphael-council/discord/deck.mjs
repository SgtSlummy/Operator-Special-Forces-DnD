/**
 * Raphael's Discord play deck. Rendering only: no login, network, or game mutation.
 * Cards contain public sample copy. Pass already-authorized projections as patches.
 * Discord reference: https://docs.discord.com/developers/components/reference
 */
const button = (id, label, kind, target, effect, access = 'member', style = 2) =>
  ({ id, label, kind, target, effect, access, style });
const view = (id, label, target, access = 'member') => button(id, label, 'view', target, 'Open a private view; do not change the scene.', access);
const form = (id, label, target, style = 2) => button(id, label, 'modal', target, 'Collect the clicking player’s words as a draft.', 'member', style);
const command = (id, label, target, effect, access = 'member', style = 2) => button(id, label, 'command', target, effect, access, style);
const home = () => view('home', 'Back to deck', 'home');
const hero = () => view('hero', 'My hero', 'hero');
const image = () => command('image', 'Show what I see', 'request_scene_image', 'Privately depict the current authorized view, even outside your turn or during a pause. Spend no action or game time.');
const pause = () => command('pause', 'Pause play', 'pause_session', 'Pause immediately; require no explanation. Freeze game time.', 'member');
const card = (title, visibility, body, rows) => ({ title, visibility, body, rows });

export const CARDS = {
  home: card('Raphael’s Council · The Last Hearth', 'shared',
    'The Lanterns of Greyharbor · Day 6\nChoose a card, or describe what you want to do. You never need a slash command.\nNew here? Join the company first.', [
      [button('join', 'Join the company', 'modal', 'join', 'Request a hero seat; show a private character draft.', 'visitor', 1),
        view('resume', 'Resume adventure', 'scene'), view('missions', 'Missions', 'missions'), image()],
      [hero(), view('world', 'World & journal', 'world'), view('help', 'How to play', 'help', 'visitor'),
        view('host', 'Table settings', 'host', 'host')],
    ]),
  lobby: card('Gather the company', 'shared',
    'Review your hero, then mark yourself ready.\nThe session host selects today’s roster. Absent players are never treated as ready.', [
      [command('ready', 'I’m ready', 'set_ready', 'Mark only the clicking player ready.', 'member', 3),
        command('away', 'Sit this session out', 'set_away', 'Remove your ready status and ask to leave the current roster.'), hero()],
      [command('begin', 'Begin session', 'begin_session', 'Host opens play only when every roster member has a valid hero and is ready.', 'host', 1), home()],
    ]),
  hero: card('Your hero · Only you', 'private',
    'Your character, condition, abilities, equipment, and promises appear here.\nDescribe a new hero in your own words. Raphael returns a draft for you to review.', [
      [form('edit', 'Describe my hero', 'hero', 1),
        command('approve', 'Approve hero draft', 'approve_hero', 'Approve your own validated draft; never invent rule statistics.', 'owner', 3),
        form('import', 'Import PDF', 'importpdf'), form('update', 'Upload Updated PDF', 'importpdf'),
        command('imports', 'Review Import', 'review_import', 'Reopen only your own saved import draft.')],
      [form('equipment', 'Use or give an item', 'equipment'), form('ability', 'Use an ability', 'ability'), home()],
    ]),
  missions: card('Three requests at the Last Hearth', 'private',
    'The Lantern Accord — a settlement’s festival debt.\nThe Quiet Archive — a missing record and a public hearing.\nThe Ember Vigil — alarms on an apparently empty road.\nOpening a briefing does not accept its mission.', [
      [button('accord', 'Lantern Accord', 'brief', 'accord', 'Open the accord briefing privately.'),
        button('archive', 'Quiet Archive', 'brief', 'archive', 'Open the archive briefing privately.'),
        button('vigil', 'Ember Vigil', 'brief', 'vigil', 'Open the vigil briefing privately.')],
      [form('other', 'Suggest another mission', 'proposal'), home()],
    ]),
  brief: card('Mission briefing · The Lantern Accord', 'private',
    'Nera asks the company to help Bellweather resolve a disputed debt.\nDeadline: sunset, Day 8. Known cost: the repair bill still needs a settlement.\nUnknown: why the guarantor is not recognized.\nSuccess means a workable agreement the residents accept.', [
      [command('propose', 'Propose this mission', 'propose_mission', 'Create a shared proposal for the roster; do not travel yet.', 'member', 1),
        form('question', 'Ask about the mission', 'question')],
      [view('missions', 'Other missions', 'missions'), hero(), home()],
    ]),
  decision: card('Company decision · A proposed plan', 'shared',
    'Proposed: travel to Bellweather and hear the residents’ account.\nShow the named roster, each response, and the proposed time/resource cost here.\nEvery roster member responds. A tie, objection, or silence keeps the decision open.', [
      [command('support', 'Support plan', 'support_proposal', 'Record one replaceable support vote from this roster member.'),
        command('object', 'Object', 'object_proposal', 'Record an objection without requiring an explanation.'),
        form('discuss', 'Discuss or suggest changes', 'proposal')],
      [command('withdraw', 'Withdraw my response', 'withdraw_vote', 'Remove only your vote while the proposal remains open.'),
        command('confirm', 'Confirm agreed plan', 'commit_proposal', 'Commit once only after every roster member supports the current revision.', 'member', 3), pause()],
    ]),
  scene: card('Day 6 · The unlit lantern', 'shared',
    'Rain taps the Last Hearth’s windows. Lysa places an unlit paper bird on the table.\n“I cannot remember who gave it to me.”\nYou remember a ferryman at yesterday’s door.\nWhat do you do?', [
      [form('act', 'Do something else', 'act', 1), form('speak', 'Speak', 'speak'), form('look', 'Look closer', 'look')],
      [form('support', 'Help an ally', 'support'), form('raphael', 'Ask Raphael', 'counsel'), image()],
      [hero(), view('journal', 'Journal', 'journal'), pause()],
    ]),
  review: card('Your action · Review before acting', 'private',
    'You intend to examine the lantern without damaging it.\nRaphael shows the understood intent, target, any cost, and whether a check is needed.\nNothing has been rolled or spent yet.', [
      [command('confirm', 'Confirm action', 'confirm_action', 'Validate the actor-owned draft against the current scene; create one pending check or commit a certain action.', 'owner', 3),
        form('revise', 'Change my approach', 'act'), command('cancel', 'Cancel action', 'cancel_action', 'Discard the uncommitted draft.', 'owner')],
    ]),
  check: card('A check is needed · Only you', 'private',
    'Example check: interpret faint markings before the ink fades.\nThe rules engine supplies the die, applicable modifier, and visible stakes.\nThe result has not been generated. Press once when ready.', [
      [command('roll', 'Roll dice', 'resolve_check', 'Resolve the actor-owned pending check once and save the result before narration.', 'owner', 1),
        form('change', 'Change my approach', 'act'),
        command('cancel', 'Cancel action', 'cancel_action', 'Cancel only an unresolved check; a saved result cannot be discarded.', 'owner')],
    ]),
  result: card('The world answers', 'shared',
    'Show the resolved action, any roll and modifier, and the observable consequence.\nShow a saved-event receipt. Hidden causes remain hidden.\nA setback offers another way forward.', [
      [view('continue', 'Continue scene', 'scene'), view('journal', 'What changed?', 'journal'),
        form('question', 'Ask a follow-up', 'question'), pause(), image()],
    ]),
  turn: card('Your turn · Only you', 'private',
    'Show your available actions, movement, reactions, conditions, and resources under the selected rules.\nDescribe your intended action and target. Raphael checks the rules before anything is spent.', [
      [form('act', 'Act or move', 'act', 1), form('ability', 'Use an ability', 'ability'), form('help', 'Help an ally', 'support'), image()],
      [command('end', 'End my turn', 'end_turn', 'Advance only the current actor’s turn after any pending resolution finishes.', 'owner'),
        hero(), form('raphael', 'Ask Raphael', 'counsel'), pause()],
    ]),
  counsel: card('Raphael’s counsel · Only you', 'private',
    '“You remember the visitor. Ask what remained after he left.”\nThis counsel points to your own observation and leaves the discovery to you.\nYour next visit will recover this same saved counsel.', [
      [view('share', 'Share with the party', 'share'), form('followup', 'Ask a follow-up', 'counsel'), home()],
    ]),
  share: card('Share this counsel?', 'private',
    'Show the exact saved hint that will be posted to the company.\nPrivate notes and the question that led to it stay private.', [
      [command('confirm', 'Share this hint', 'share_counsel', 'Publish only the owner-approved saved hint once.', 'owner', 3),
        view('cancel', 'Keep it private', 'counsel')],
    ]),
  world: card('The Reach you know · Only you', 'private',
    'Browse discovered places, people, promises, and public events.\nUndiscovered locations and secret motives do not appear as locked entries.', [
      [button('places', 'Places', 'browse', 'places', 'Open a paginated discovered-place list.'),
        button('people', 'People', 'browse', 'people', 'Open people known to this player.'),
        button('factions', 'Factions', 'browse', 'factions', 'Open known faction positions, not private plans.')],
      [view('journal', 'Journal', 'journal'), view('party', 'Company', 'party'), home()],
    ]),
  journal: card('Your journal · Only you', 'private',
    'Show a page of known facts, rumors labeled as rumors, and open promises.\nA player note cannot rewrite established history.', [
      [form('note', 'Add a note', 'note'), form('search', 'Find something', 'question'),
        button('prev', 'Previous', 'page', 'previous', 'Read the previous authorized journal page.'),
        button('next', 'Next', 'page', 'next', 'Read the next authorized journal page.')], [home()],
    ]),
  party: card('Your company · Only you', 'private',
    'Show participating heroes, shared conditions, and availability.\nPrivate character notes and counsel belong to their recipients.', [
      [form('help', 'Help an ally', 'support'), hero(), view('lobby', 'Session roster', 'lobby'), home()],
    ]),
  debrief: card('Back at the Last Hearth', 'shared',
    'Show what was accomplished, what it cost, whose lives changed, and what remains unresolved.\nThese results are already saved. Reading the debrief does not apply them again.', [
      [view('journal', 'Read the record', 'journal'), form('correction', 'Flag a correction', 'correction'),
        view('downtime', 'Plan downtime', 'downtime')],
      [view('missions', 'Next requests', 'missions'), command('end', 'Propose session end', 'propose_end', 'Ask the roster to agree on ending the session; do not advance world time.'), pause()],
    ]),
  downtime: card('Time at the Last Hearth · Only you', 'private',
    'Rest, tend a relationship, pursue a promise, or describe another activity.\nA plan that advances time shows its duration and known deadlines to the whole company before agreement.', [
      [form('rest', 'Plan a rest', 'downtime'), form('bond', 'Visit someone', 'downtime'), form('other', 'Do something else', 'downtime')], [home()],
    ]),
  paused: card('The company is paused', 'shared',
    'Nobody needs to explain a pause. Actions and in-world time are frozen.\nEach current roster member can mark ready; play resumes only when all are ready.', [
      [command('ready', 'Ready to resume', 'ready_resume', 'Record only this player’s readiness. A timeout is not readiness.', 'member', 3),
        form('private', 'Leave a private note', 'note'), view('recap', 'Read the recap', 'saved')],
      [command('end', 'Propose session end', 'propose_end', 'Offer a session-end decision while keeping play paused.'), image()],
    ]),
  saved: card('The lanterns will be here', 'shared',
    'Show the last committed scene, game day, open promises, and save receipt.\nA week away from Discord does not advance the world.\nReturn here when the company is ready.', [
      [view('resume', 'Gather to resume', 'lobby'), view('journal', 'Read the journal', 'journal'), hero(), home(), image()],
    ]),
  stale: card('A newer moment is waiting · Only you', 'private',
    'This card belongs to an earlier scene or proposal. Your attempted action made no change.\nOpen the current card; a completed roll will show its original result.', [
      [view('current', 'Open current scene', 'scene'), hero(), view('help', 'Get help', 'help'), image()],
    ]),
  help: card('Play with buttons and your words', 'private',
    '1. Join the company and describe your hero.\n2. Open a scene and choose a button.\n3. Type what you intend; review Raphael’s interpretation.\n4. Roll only when a check is requested.\nAsk Raphael for a nudge. Pause whenever needed.\nNo commands or dice formulas to memorize.', [
      [home(), hero(), form('ask', 'Ask a rules question', 'question')],
    ]),
  host: card('Session host · Only you', 'private',
    'The host manages the table, roster, and deck location. They do not decide every story outcome.\nDescribe setup changes, then review their exact effect before applying them.', [
      [button('configure', 'Configure the table', 'modal', 'setup', 'Collect configuration in natural language and show a validated draft.', 'host', 1),
        command('apply', 'Apply settings draft', 'apply_setup', 'Apply only the host-owned validated settings draft; cannot overwrite story state or consent.', 'host', 3),
        command('refresh', 'Restore deck message', 'restore_deck', 'Recreate a missing shared deck from persistent state, never reset the campaign.', 'host')],
      [view('roster', 'Review roster', 'lobby'), home()],
    ]),
};

const field = (id, label, placeholder, maxLength = 1000, required = true, short = false) =>
  ({ id, label, placeholder, maxLength, required, style: short ? 1 : 2 });
const modal = (title, submit, fields) => ({ title, submit, fields });
export const MODALS = {
  sceneimage: modal('Show what I see', 'request_scene_image', [
    field('focus', 'Visible subject (optional)', 'Leave empty for the whole scene, or enter a visible subject shown on the image card.', 120, false, true),
  ]),
  importpdf: modal('Import a 2024 character PDF', 'import_pdf', [
    { id: 'pdf', type: 'file', label: 'Character sheet PDF', required: true, minValues: 1, maxValues: 1 },
    field('edition', 'Confirm your campaign rules edition', 'Type 2024 to confirm this sheet uses our 2024 rules.', 4, true, true),
  ]),
  importcorrect: modal('Correct character details', 'correct_import', [
    field('correction', 'What should this sheet say?', 'My Dexterity is 16. My AC is 15. One correction per line.', 1500),
  ]),
  join: modal('Join the Lantern Compact', 'draft_hero', [field('name', 'What is your hero called?', 'Maren Ash', 60, true, true),
    field('concept', 'Describe your hero', 'A ranger who once went back for a stranger. I keep a promise to Lysa.')]),
  hero: modal('Describe your hero', 'draft_hero', [field('concept', 'Who are you?', 'Name, talents, a bond, and what brought you to the company.', 1500),
    field('rules', 'Existing character details (optional)', 'Class, level, abilities, or an approved character sheet summary.', 1500, false)]),
  act: modal('What do you do?', 'draft_action', [field('intent', 'Describe your intention and target', 'I examine the paper bird without tearing it. I want to learn who made it.')]),
  speak: modal('Speak in character', 'draft_speech', [field('speech', 'Who are you speaking to, and what do you say?', 'I ask Lysa what she remembers about yesterday’s visitor.')]),
  look: modal('Look closer', 'draft_observation', [field('subject', 'What do you examine?', 'The lantern’s painted wing and the markings beneath it.')]),
  support: modal('Help an ally', 'draft_support', [field('support', 'Who do you help, and how?', 'I hold the lantern steady while Maren examines the writing.')]),
  counsel: modal('Ask Raphael privately', 'request_counsel', [field('question', 'Where would guidance help?', 'I feel stuck. What detail have we already noticed that deserves another look?')]),
  question: modal('Ask in your own words', 'answer_question', [field('question', 'What would you like to know?', 'What do we know about the deadline at Bellweather?')]),
  proposal: modal('Suggest a company plan', 'draft_proposal', [field('plan', 'Describe your proposal', 'Could we hear the ferryman’s account before deciding which request to accept?')]),
  equipment: modal('Use or give an item', 'draft_equipment', [field('intent', 'Which item, and what do you want to do?', 'I offer my spare lantern to Lysa; she can decide whether to accept it.')]),
  ability: modal('Use an ability', 'draft_ability', [field('intent', 'Which ability, target, and intended effect?', 'I use my known light spell on the empty lamp to see whether the flame behaves differently.')]),
  note: modal('A private note', 'save_private_note', [field('note', 'What do you want to remember?', 'A thought, a question, or a note for next session.', 1500)]),
  correction: modal('Flag a correction', 'request_correction', [field('issue', 'What seems wrong, and what should be checked?', 'We returned the record to Oren. The recap says we kept it.', 1500)]),
  downtime: modal('Plan time between missions', 'draft_downtime', [field('plan', 'What do you want to do, and for how long?', 'I want to rest overnight and visit Lysa in the morning.')]),
  setup: modal('Configure the company', 'draft_setup', [field('setup', 'Describe the table you want', 'Four players, cooperative decisions, evening sessions. Use our agreed D&D rules.', 1500)]),
};

// Briefs are public information from the authored opening. No DM secret is embedded.
export const BRIEFS = {
  accord: { title: 'The Lantern Accord', body: CARDS.brief.body },
  archive: { title: 'The Quiet Archive', body: 'Oren asks you to recover a missing civic record.\nDeadline: the Day 9 hearing.\nKnown stake: his mentor’s reputation and access to the Archive.\nFind reliable evidence; the missing record may not tell a simple story.' },
  vigil: { title: 'The Ember Vigil', body: 'Ember Crossing asks for help understanding repeated alarms.\nDeadline: the Day 8 morning assembly.\nKnown stake: exhausted watchkeepers and frightened residents.\nFind out what is happening and help the community decide its response.' },
};

const own = (object, key) => Object.hasOwn(object, key);
function definition(registry, id) {
  if (!own(registry, id)) throw new Error(`Unknown deck definition: ${id}`);
  return registry[id];
}
function shortId(value, name, max = 18) {
  if (typeof value !== 'string' || !new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`).test(value)) throw new Error(`Invalid ${name}`);
  return value;
}
function binding(context) {
  const session = shortId(context.session, 'session');
  const view = shortId(context.view, 'view');
  if (!Number.isSafeInteger(context.revision) || context.revision < 0) throw new Error('Invalid revision');
  return `rph:1:${session}:${view}:${context.revision}`;
}
function customId(context, cardId, action) {
  const id = `${binding(context)}:${shortId(cardId, 'card', 24)}:${shortId(action, 'action', 24)}`;
  if (id.length > 100) throw new Error('Custom ID too long');
  return id;
}
export function parseId(id) {
  if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid component ID');
  const pieces = id.split(':');
  if (pieces.length !== 7 || pieces[0] !== 'rph' || pieces[1] !== '1' || !/^\d+$/.test(pieces[4])) throw new Error('Invalid component ID');
  const result = { session: pieces[2], view: pieces[3], revision: Number(pieces[4]), card: pieces[5], action: pieces[6] };
  if (customId(result, result.card, result.action) !== id) throw new Error('Noncanonical component ID');
  return result;
}
export function actionFor(id) {
  const parsed = parseId(id);
  if (parsed.card === 'modal') {
    const spec = definition(MODALS, parsed.action);
    return { ...parsed, kind: 'submission', target: spec.submit };
  }
  const spec = definition(CARDS, parsed.card);
  const action = spec.rows.flat().find(item => item.id === parsed.action);
  if (!action) throw new Error('Unknown action');
  return { ...parsed, ...action };
}

/** Render only after an adapter selects a projection the recipient is allowed to see. */
export function renderCard(cardId, context, patch = {}) {
  const spec = definition(CARDS, cardId);
  const title = patch.title ?? spec.title;
  const body = patch.body ?? spec.body;
  if (typeof title !== 'string' || title.length > 120 || typeof body !== 'string' || body.length > 2800) throw new Error('Paginate oversized card text');
  const disabled = patch.disabled ?? [];
  if (!Array.isArray(disabled) || disabled.some(id => !spec.rows.flat().some(b => b.id === id))) throw new Error('Unknown disabled action');
  const hidden = patch.hidden ?? [];
  if (!Array.isArray(hidden) || hidden.some(id => !spec.rows.flat().some(b => b.id === id))) throw new Error('Unknown hidden action');
  const rows = spec.rows.map(row => row.filter(b => !hidden.includes(b.id))).filter(row => row.length);
  const privateResponse = spec.visibility === 'private' || context.private === true;
  return {
    flags: 32768 | (privateResponse ? 64 : 0),
    allowed_mentions: { parse: [] },
    components: [
      { type: 10, content: `## ${title}\n${body}` },
      ...rows.map(row => ({ type: 1, components: row.map(b => ({
        type: 2, style: b.style, label: b.label,
        custom_id: customId(context, cardId, b.id), disabled: disabled.includes(b.id),
      })) })),
    ],
  };
}

/** Return an initial MODAL callback; the adapter must not defer before showing it. */
export function renderModal(modalId, context) {
  const spec = definition(MODALS, modalId);
  return { type: 9, data: {
    title: spec.title, custom_id: customId(context, 'modal', modalId),
    components: spec.fields.map(f => ({ type: 18, label: f.label,
      component: f.type === 'file' ? { type: 19, custom_id: f.id, required: f.required,
        min_values: f.minValues, max_values: f.maxValues, file_types: ['.pdf'] } :
      { type: 4, custom_id: f.id, style: f.style, placeholder: f.placeholder,
        required: f.required, min_length: f.required ? 1 : 0, max_length: f.maxLength },
    })),
  } };
}

/** Current Label wrappers and older ActionRow submissions can both be parsed. */
export function readModal(modalId, components) {
  const spec = definition(MODALS, modalId);
  if (!Array.isArray(components) || components.length > 5) throw new Error('Invalid modal input');
  const fields = [];
  for (const wrapper of components) {
    if (wrapper?.type === 18 && [4, 19].includes(wrapper.component?.type)) fields.push(wrapper.component);
    else if (wrapper?.type === 1 && Array.isArray(wrapper.components) && wrapper.components.every(f => f?.type === 4)) fields.push(...wrapper.components);
    else throw new Error('Unexpected modal component');
  }
  const result = Object.create(null);
  for (const submitted of fields) {
    const f = spec.fields.find(f => f.id === submitted.custom_id);
    if (!f || own(result, f.id)) throw new Error('Invalid modal field');
    if (f.type === 'file') {
      if (submitted.type !== 19 || !Array.isArray(submitted.values) || submitted.values.length < f.minValues || submitted.values.length > f.maxValues ||
        submitted.values.some(id => typeof id !== 'string' || !/^\d{1,20}$/.test(id)) || new Set(submitted.values).size !== submitted.values.length) throw new Error('Invalid file field');
      result[f.id] = [...submitted.values];
    } else {
      if (submitted.type !== 4 || typeof submitted.value !== 'string' || submitted.value.length > f.maxLength) throw new Error('Invalid modal field');
      result[f.id] = submitted.value.trim();
    }
  }
  for (const f of spec.fields) if (f.required && !result[f.id]) throw new Error(`Missing ${f.id}`);
  return result;
}

export function validateDeck() {
  for (const [id, c] of Object.entries(CARDS)) {
    // The live scene preserves its eight play controls alongside anytime images.
    if (c.rows.length > (id === 'scene' ? 3 : 2) || c.rows.flat().length > (id === 'scene' ? 9 : 8)) throw new Error(`${id}: simplify card rows`);
    const seen = new Set();
    for (const row of c.rows) {
      if (row.length < 1 || row.length > 5) throw new Error(`${id}: invalid button row`);
      for (const b of row) {
        if (seen.has(b.id) || b.label.length > 38 || !b.effect) throw new Error(`${id}: invalid button`);
        seen.add(b.id);
        if (b.kind === 'view') definition(CARDS, b.target);
        if (b.kind === 'modal') definition(MODALS, b.target);
        if (b.kind === 'brief') definition(BRIEFS, b.target);
      }
    }
  }
  for (const m of Object.values(MODALS)) {
    if (m.title.length > 45 || m.fields.length < 1 || m.fields.length > 5) throw new Error('Invalid modal layout');
    for (const f of m.fields) {
      if (f.label.length > 45) throw new Error('Invalid modal field layout');
      if (f.type === 'file') {
        if (f.minValues !== 1 || f.maxValues !== 1) throw new Error('Invalid file field layout');
      } else if (f.placeholder.length > 100 || f.maxLength > 4000) throw new Error('Invalid modal field layout');
    }
  }
  return { cards: Object.keys(CARDS).length, modals: Object.keys(MODALS).length };
}
