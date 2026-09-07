import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { checkConsequenceFields } from './check-consequence-fields.mjs';
import { GameError } from '../game/store.mjs';
import { getCharacterOptions, getCharacterInfo } from '../game/character-info.mjs';
import { coordinate } from '../maps/grid.mjs';
import { renderTacticalMap } from '../maps/render.mjs';

const MORE = { type: 2, custom_id: 'rpc:home', label: 'More information', style: 2 };
const TABLE = { type: 2, custom_id: 'rpg:home', label: 'Tactical table', style: 2 };
const stable = (action, label) => ({ type: 2, custom_id: `rpc:${action}`, label, style: 2 });
const fail = () => { throw new GameError('INVALID', 'Open More information again.'); };
const valueText = value => value == null ? 'Not provided' : String(value);
const clip = (text, length) => String(text).slice(0, length);

// Split before escaping so a page never cuts a Markdown escape in half. Every
// source character is retained; long field values continue on following pages.
export function informationPages(groups, notes = []) {
  const pages = [];
  for (const group of [...groups, ...(notes.length ? [{ title: 'Notes', fields: notes.map((value, i) => ({ label: `Note ${i + 1}`, value })) }] : [])]) {
    const source = group.fields.map(field => `${field.label}: ${valueText(field.value)}`).join('\n\n') || 'No information supplied.';
    let rest = source;
    while (rest.length) {
      let length = Math.min(rest.length, 950);
      if (length < rest.length && /[\uD800-\uDBFF]/.test(rest[length - 1])) length--;
      pages.push({ title: group.title, text: rest.slice(0, length) });
      rest = rest.slice(length);
    }
  }
  return pages.length ? pages : [{ title: 'Information', text: 'No information is available yet.' }];
}

function navigation(game, scope, context, record, page, total) {
  const make = (label, next, disabled) => {
    const id = game.createControl(scope, context, { ...record, page: Math.min(Math.max(0, next), total - 1) });
    return { type: 2, custom_id: `rpc:${id}:page`, label, style: 2, disabled };
  };
  return [make('Previous page', page - 1, page === 0), make('Next page', page + 1, page === total - 1), MORE, TABLE];
}

function pageCard(game, scope, context, record, title, pages, heading = '') {
  const page = Math.min(Math.max(0, record.page ?? 0), pages.length - 1);
  const selected = pages[page];
  return screen(clip(title, 110), `${heading}${heading ? '\n\n' : ''}Page ${page + 1}/${pages.length} · ${safeText(selected.title)}\n\n${safeText(selected.text)}`,
    navigation(game, scope, context, record, page, pages.length));
}

function menu() {
  return screen('Your companion · Only you', 'The same authorized campaign information is available here as in the browser. Read character details, visible map information and saved results at any time. Open Checks & rolls for opportunity reactions. Looking through these controls spends no action or resource.', [
    stable('characters', 'Character details'), stable('actors', 'Visible characters'), stable('effects', 'Lingering effects'), stable('rolls', 'Checks & rolls'), stable('updates', 'Saved map updates'), stable('journal', 'Campaign journal'),
    { type: 2, custom_id: 'rpi:home', label: 'My Hero / imported sheet', style: 2 },
    { type: 2, custom_id: 'rps:home', label: 'Show what I see', style: 2 },
    { type: 2, custom_id: 'rps:reach', label: 'Distance & reach', style: 2 }, TABLE,
  ]);
}

function characterPicker(game, scope, context, record = {}) {
  const options = getCharacterOptions(game, scope);
  if (record.revision !== undefined && record.revision !== options.revision) throw new GameError('STALE', '');
  const total = Math.max(1, Math.ceil(options.actors.length / 10)), page = Math.min(record.page ?? 0, total - 1);
  const offered = options.actors.slice(page * 10, (page + 1) * 10);
  const binding = { kind: 'characters', revision: options.revision, page };
  const id = game.createControl(scope, context, { ...binding, actorIds: offered.map(actor => actor.id) });
  const data = screen('Character details · Only you', `${safeText(options.mapTitle)} · revision ${options.revision}\nChoose a visible character. Private sheet and combat statistics are shown only when authorized.\nPage ${page + 1}/${total}`,
    navigation(game, scope, context, binding, page, total));
  if (offered.length) data.components.splice(1, 0, { type: 1, components: [{ type: 3, custom_id: `rpc:${id}:character`, placeholder: 'Choose a visible character', min_values: 1, max_values: 1,
    options: offered.map(actor => ({ label: clip(actor.label, 100), value: actor.id, description: actor.controlled ? 'Character you control' : 'Visible character' })),
  }] });
  else data.components[0].content += '\nNo visible characters are available.';
  return data;
}

function actorGroups(view) {
  return view.actors.map(actor => ({ title: actor.name, fields: [
    { label: 'Name', value: actor.name }, { label: 'ID', value: actor.id }, { label: 'Position', value: coordinate(actor.x, actor.y) },
    { label: 'Footprint', value: `${actor.size} × ${actor.size} cells` }, { label: 'Status', value: actor.defeated ? 'Down' : 'Standing' },
    ...(actor.hp === undefined ? [] : [{ label: 'Current HP', value: `${actor.hp}/${actor.maxHp}` }]),
  ] }));
}
function effectGroups(view) {
  return view.effects.map(effect => ({ title: effect.name, fields: [
    { label: 'Name', value: effect.name }, { label: 'Trigger', value: effect.trigger },
    { label: 'Visible cells', value: effect.cells.map(point => coordinate(point.x, point.y)).join(', ') },
    { label: 'Expires before turn', value: effect.expiresAtTurn },
  ] }));
}
function receiptGroups(receipts) {
  return receipts.filter(receipt => ['attack', 'check', 'save'].includes(receipt.result?.type)).map(receipt => {
    const result = receipt.result, attack = result.type === 'attack';
    const dice = result.dice ?? [], keptIndex = Number.isInteger(result.keptIndex) ? result.keptIndex : 0;
    return { title: `Saved ${result.type} · revision ${receipt.revision}`, fields: [
      { label: 'Revision', value: receipt.revision }, { label: 'Request ID', value: receipt.requestId }, { label: 'Character ID', value: result.actorId },
      ...(attack ? [{ label: 'Target ID', value: result.targetId }, { label: 'Weapon', value: result.weapon }] : [
        { label: 'Check', value: result.label }, { label: 'Ability', value: result.ability }, { label: 'Mode', value: result.mode ?? 'normal' },
        { label: 'Advantage sources', value: (result.advantage ?? []).join(', ') || 'None' },
        { label: 'Disadvantage sources', value: (result.disadvantage ?? []).join(', ') || 'None' },
      ]),
      { label: 'Roll', value: dice.join(', ') }, { label: 'Kept die', value: dice[keptIndex] },
      { label: 'Discarded dice', value: (result.discardedDice ?? dice.filter((_, index) => index !== keptIndex)).join(', ') || 'None' },
      ...(result.modifiers ?? []).map((modifier, i) => ({ label: `Modifier ${i + 1} · ${modifier.source}`, value: modifier.value })),
      { label: 'Total', value: result.total }, { label: 'Result', value: attack ? (result.hit ? 'Hit' : 'Miss') : (typeof result.success === 'boolean' ? (result.success ? 'Success' : 'Failure') : 'Not recorded') },
      ...(attack ? [
        { label: 'Critical', value: result.critical }, { label: 'Damage dice', value: (result.damageDice ?? []).join(', ') },
        { label: 'Damage modifier', value: result.damageModifier }, { label: 'Damage', value: result.damage },
      ] : []),
      ...checkConsequenceFields(result),
      { label: 'Character version', value: result.characterVersion }, { label: 'Rules version', value: result.rulesVersion },
    ] };
  });
}

function rollHistoryCard(game, scope, context, record) {
  const history = game.rollHistory(scope, record.before);
  // Freeze this group's upper bound so a new roll cannot shift its text pages.
  const current = { kind: 'rolls', before: record.before ?? (history.receipts[0]?.revision + 1 || undefined), page: 0, newer: record.newer };
  const pages = informationPages(receiptGroups(history.receipts));
  const page = Math.min(Math.max(0, record.page ?? 0), pages.length - 1), selected = pages[page];
  const textButtons = navigation(game, scope, context, current, page, pages.length).slice(0, 2);
  const previous = game.createControl(scope, context, current);
  const older = history.nextBefore === null ? null : game.createControl(scope, context, { kind: 'rolls', before: history.nextBefore, page: 0, newer: previous });
  const cursorButton = (label, id) => ({ type: 2, custom_id: id ? `rpc:${id}:page` : 'rpc:rolls', label, style: 2, disabled: !id });
  const heading = history.receipts.length ? `${history.receipts.length} saved rolls in this group · revisions ${history.receipts.at(-1).revision}–${history.receipts[0].revision}` : 'No saved attacks, checks or saves yet.';
  return screen('Your saved rolls · Only you', `${heading}\nThese saved results remain unchanged when play advances.\n\nReceipt page ${page + 1}/${pages.length} · ${safeText(selected.title)}\n\n${safeText(selected.text)}`,
    [...textButtons, cursorButton('Newer rolls', record.newer), cursorButton('Older rolls', older), MORE, TABLE]);
}

function historicalCard(game, scope, context, record, view) {
  if (typeof game.updates !== 'function') throw new GameError('UNSUPPORTED', '');
  const after = record.after ?? 0;
  const result = game.updates(scope, after, 1);
  const frame = result.views[0];
  if (!frame) return screen('Saved map updates · Only you', 'No saved map updates are available after this revision.', [stable('updates', 'First saved update'), MORE, TABLE]);
  const groups = [{ title: 'Saved map state', fields: [
    { label: 'Map', value: frame.map.title }, { label: 'Saved revision', value: frame.revision }, { label: 'Round', value: frame.round },
    { label: 'Turn', value: frame.turn }, { label: 'Phase', value: frame.phase },
    { label: 'Active character ID', value: frame.activeActorId }, { label: 'Movement remaining', value: frame.movementRemaining },
    { label: 'Action available', value: frame.actionAvailable },
  ] }, ...actorGroups(frame), ...effectGroups(frame)];
  const data = pageCard(game, scope, context, { ...record, kind: 'updates', after }, 'Saved map update · Only you', informationPages(groups),
    `Saved revision ${frame.revision} · current revision ${view.revision}. This historical view cannot perform actions.`);
  const revisionButton = (label, cursor, disabled) => {
    const id = game.createControl(scope, context, { kind: 'updates', after: Math.max(0, cursor), page: 0 });
    return { type: 2, custom_id: `rpc:${id}:page`, label, style: 2, disabled };
  };
  data.components.push({ type: 1, components: [revisionButton('Previous revision', frame.revision - 2, frame.revision <= 1), revisionButton('Next revision', frame.revision, frame.revision >= result.current)] });
  const png = renderTacticalMap(frame, { cellSize: Math.min(64, Math.floor(3900 / Math.max(frame.map.width, frame.map.height))) });
  if (png.length <= 9 * 1024 * 1024) {
    const name = `saved-map-${frame.revision}.png`;
    data.attachments = [{ id: '0', filename: name, description: `Authorized saved map at revision ${frame.revision}` }];
    data.components.splice(1, 0, { type: 12, items: [{ media: { url: `attachment://${name}` }, description: `Saved map revision ${frame.revision}` }] });
    data.files = [{ data: png, name, contentType: 'image/png' }];
  } else data.components[0].content += '\nThe saved image exceeds the attachment limit; all character and effect details remain on the following pages.';
  return data;
}

function journalCard(game, scope, context, record, view) {
  if (typeof game.journal !== 'function') throw new GameError('UNSUPPORTED', '');
  const after = record.after ?? 0;
  const result = game.journal(scope, after, 20);
  const groups = result.entries.map(entry => ({ title: entry.scene, fields: [
    { label: 'Scene', value: entry.scene }, { label: 'Round', value: entry.round }, { label: 'Turn', value: entry.turn },
    { label: 'Source', value: entry.source }, ...entry.facts.map((value, i) => ({ label: `Observed change ${i + 1}`, value })),
  ] }));
  const data = pageCard(game, scope, context, { ...record, kind: 'journal', after }, 'Campaign journal · Only you', informationPages(groups),
    `Observed saved changes after revision ${after} through ${result.next} · current revision ${view.revision}.`);
  const batch = (label, cursor, disabled) => {
    const id = game.createControl(scope, context, { kind: 'journal', after: Math.max(0, cursor), page: 0 });
    return { type: 2, custom_id: `rpc:${id}:page`, label, style: 2, disabled };
  };
  data.components.push({ type: 1, components: [batch('Earlier revisions', after - 20, after === 0), batch('Later revisions', result.next, !result.hasMore)] });
  return data;
}

/** All companion actions are reads. The only writes are private UI bindings. */
export function createCompanionHandler({ game, characters, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !customId.startsWith('rpc:')) return false;
    let deferred = false;
    const deliver = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      game.member(scope);
      if (interaction.type !== 3) fail();
      // Acknowledge before projections, sheet reads, or a potentially large map
      // render. Every companion control is read-only and needs no modal reply.
      await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } });
      deferred = true;
      const view = game.view(scope);
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      if (customId === 'rpc:home') { await deliver(menu()); return true; }
      let record;
      if (/^rpc:(characters|actors|effects|rolls|updates|journal)$/.test(customId)) record = { kind: customId.slice(4), page: 0 };
      else {
        const match = /^rpc:([a-f0-9]{24}):(page|character)$/.exec(customId);
        if (!match) fail();
        record = game.control(scope, context, match[1]);
        if (match[2] === 'character') {
          if (record.kind !== 'characters' || !Array.isArray(record.actorIds) || !Array.isArray(interaction.data.values) || interaction.data.values.length !== 1 || !record.actorIds.includes(interaction.data.values[0])) fail();
          record = { kind: 'character', actorId: interaction.data.values[0], revision: record.revision, page: 0 };
        }
      }
      if (record.kind !== 'rolls' && record.revision !== undefined && record.revision !== view.revision) throw new GameError('STALE', '');
      if (record.kind === 'characters') { await deliver(characterPicker(game, scope, context, record)); return true; }
      if (record.kind === 'character') {
        const info = getCharacterInfo(game, characters, scope, { actorId: record.actorId, expectedRevision: record.revision });
        const pages = informationPages(info.groups, info.notes);
        await deliver(pageCard(game, scope, context, { ...record, revision: info.revision }, 'Character details · Only you', pages, `${safeText(info.mapTitle)} · revision ${info.revision}`)); return true;
      }
      if (record.kind === 'updates') { await deliver(historicalCard(game, scope, context, record, view)); return true; }
      if (record.kind === 'journal') { await deliver(journalCard(game, scope, context, record, view)); return true; }
      if (record.kind === 'rolls') { await deliver(rollHistoryCard(game, scope, context, record)); return true; }
      const groups = record.kind === 'actors' ? actorGroups(view) : record.kind === 'effects' ? effectGroups(view) : null;
      if (!groups) fail();
      const title = { actors: 'Visible characters', effects: 'Lingering effects' }[record.kind];
      await deliver(pageCard(game, scope, context, { ...record, revision: view.revision }, `${title} · Only you`, informationPages(groups),
        `${safeText(view.map.title)} · revision ${view.revision}`));
      return true;
    } catch (error) {
      const message = error instanceof GameError ? ({
        STALE: 'The tactical map changed. Open More information again to read the current view.',
        UNAUTHORIZED: 'This information is unavailable to your current player. Open your own campaign controls.',
        NOT_VISIBLE: 'That character is no longer visible. Choose a character from the current view.',
        NOT_FOUND: 'The host has not prepared this campaign yet.',
        UNSUPPORTED: 'Saved updates are not available for this campaign yet.',
      })[error.code] || 'Open More information again and choose a current character or page.' : 'This information could not be loaded. Open More information again.';
      log({ outcome: 'companion_rejected', expected: error instanceof GameError });
      const data = screen('Companion status · Only you', message, [MORE, TABLE]);
      try {
        if (deferred) await transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
        else await transport.respond(interaction.id, interaction.token, { type: 4, data });
      } catch { log({ outcome: 'companion_delivery_failed' }); }
      return true;
    }
  };
}
