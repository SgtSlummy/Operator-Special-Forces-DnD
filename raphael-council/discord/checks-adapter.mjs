import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { informationPages } from './companion-adapter.mjs';
import { checkConsequenceFields, checkDamageWarning } from './check-consequence-fields.mjs';
import { GameError } from '../game/store.mjs';

const button = (custom_id, label, style = 2) => ({ type: 2, custom_id, label, style });
const HOME = button('rpk:home', 'Checks & rolls');
const HISTORY = button('rpk:history', 'Saved roll history');
const MORE = button('rpc:home', 'More information');
const fail = () => { throw new GameError('STALE', 'Open Checks & rolls again for current controls.'); };
const signed = value => value >= 0 ? `+${value}` : String(value);
const modifiers = values => (values || []).map(value => `${signed(value.value)} ${value.source}`).join('\n') || 'None';
const field = (label, value) => ({ label, value });
const values = items => items?.length ? items.join(', ') : 'None';

function pendingGroups(check) {
  return [{ title: check.label, fields: [
    field('Character', check.actorId), field('Roll', `${check.ability} ${check.kind === 'save' ? 'saving throw' : 'check'}`),
    field('Dice mode', check.mode), field('Modifiers', modifiers(check.modifiers)),
    field('Cost', check.cost === 'action' ? 'Spends your action. You must be able to act on your turn.' : 'No action cost.'),
    field('Scene revision', check.revision), field('Character version', check.characterVersion),
  ] }];
}

/** Whitelist only the shared service's player-visible roll breakdown; never render a DC. */
function receiptGroups(receipt) {
  const result = receipt.result;
  const fields = [field('Saved request', receipt.requestId), field('Scene revision', receipt.revision)];
  if (result.actorId !== undefined) fields.push(field('Character', result.actorId));
  if (result.targetId !== undefined) fields.push(field('Target', result.targetId));
  if (result.ability !== undefined) fields.push(field('Ability', result.ability));
  if (result.mode !== undefined) fields.push(field('Dice mode', result.mode));
  if (result.advantage !== undefined) fields.push(field('Advantage sources', values(result.advantage)));
  if (result.disadvantage !== undefined) fields.push(field('Disadvantage sources', values(result.disadvantage)));
  fields.push(field('Dice rolled', values(result.dice)));
  if (result.keptIndex !== undefined) fields.push(field('Kept die', `${result.dice[result.keptIndex]} (die ${result.keptIndex + 1})`));
  if (result.discardedDice !== undefined) fields.push(field('Discarded dice', values(result.discardedDice)));
  fields.push(field('Modifiers', modifiers(result.modifiers)), field('Total', result.total));
  if (result.type === 'attack') {
    if (result.weapon !== undefined) fields.push(field('Weapon', result.weapon));
    fields.push(field('Outcome', result.hit ? 'Hit' : 'Miss'), field('Damage', result.damage));
    if (result.damageModifier !== undefined) fields.push(field('Damage modifier', signed(result.damageModifier)));
    if (result.critical !== undefined) fields.push(field('Critical hit', result.critical ? 'Yes' : 'No'));
    if (result.damageDice !== undefined) fields.push(field('Damage dice', values(result.damageDice)));
    if (result.damageModifiers !== undefined) fields.push(field('Damage modifiers', modifiers(result.damageModifiers)));
  } else {
    fields.push(field('Outcome', result.success ? 'Success' : 'Failure'));
    if (result.checkId !== undefined) fields.push(field('Check', result.checkId));
  }
  fields.push(...checkConsequenceFields(result));
  if (result.characterVersion !== undefined) fields.push(field('Character version', result.characterVersion));
  if (result.rulesVersion !== undefined) fields.push(field('Rules version', result.rulesVersion));
  return [{ title: result.label || (result.type === 'attack' ? 'Attack' : result.type === 'save' ? 'Saving throw' : 'Ability check'), fields }];
}

function bound(game, scope, context, record, label, action = 'page', style = 2) {
  return button(`rpk:${game.createControl(scope, context, record)}:${action}`, label, style);
}

function pendingCard(game, scope, context, record = {}) {
  const checks = game.pendingChecks(scope);
  if (!checks.length) return screen('Pending checks · Only you', 'There are no current checks to roll. A host must prepare a check for your character. Paused play does not expose pending rolls. Looking here spends no action.', [HISTORY, HOME, MORE]);
  const index = record.checkId ? checks.findIndex(check => check.id === record.checkId) : 0;
  if (index < 0) fail();
  const check = checks[index], pages = informationPages(pendingGroups(check));
  const damageWarning = checkDamageWarning(check);
  const page = record.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) fail();
  const confirmId = record.confirmId || game.createControl(scope, context, { kind: 'check-confirm', checkId: check.id });
  const base = { kind: 'check-preview', checkId: check.id, confirmId };
  const controls = [];
  if (page > 0) controls.push(bound(game, scope, context, { ...base, page: page - 1 }, 'Previous detail'));
  if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...base, page: page + 1 }, 'Next detail'));
  if (index > 0) controls.push(bound(game, scope, context, { kind: 'check-preview', checkId: checks[index - 1].id }, 'Previous check'));
  if (index + 1 < checks.length) controls.push(bound(game, scope, context, { kind: 'check-preview', checkId: checks[index + 1].id }, 'Next check'));
  controls.push(button(`rpk:${confirmId}:confirm`, check.cost === 'action' ? 'Confirm roll · spend action' : 'Confirm roll · no action cost', 1), HISTORY, HOME);
  return screen(`Pending check ${index + 1}/${checks.length} · Only you`, `${safeText(check.label)}${damageWarning ? `\n\n${safeText(damageWarning)}` : ''}\nDetail ${page + 1}/${pages.length}\n\n${safeText(pages[page].text)}\n\nReview these details before confirming. Opening or paging this preview does not roll dice or spend an action.`, controls);
}

function historyCard(game, scope, context, record = {}) {
  const batch = game.rollHistory(scope, record.before);
  const pages = informationPages(batch.receipts.flatMap(receiptGroups));
  const page = record.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) fail();
  // Anchor this group before its newest saved revision so later rolls cannot shift its pages.
  const before = record.before ?? (batch.receipts[0] ? batch.receipts[0].revision + 1 : undefined);
  const base = { kind: 'roll-history', ...(before === undefined ? {} : { before }) };
  const controls = [];
  if (page > 0) controls.push(bound(game, scope, context, { ...base, page: page - 1 }, 'Previous detail'));
  if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...base, page: page + 1 }, 'Next detail'));
  if (batch.nextBefore !== null) controls.push(bound(game, scope, context, { kind: 'roll-history', before: batch.nextBefore }, 'Older rolls'));
  if (record.before !== undefined) controls.push(HISTORY);
  controls.push(HOME, MORE);
  return screen('Your saved rolls · Only you', batch.receipts.length ? `${safeText(pages[page].title)}\nDetail ${page + 1}/${pages.length} · ${batch.receipts.length} saved rolls in this group\n\n${safeText(pages[page].text)}\n\nSaved results only. Reading history never rerolls dice.` : 'No saved attacks, ability checks or saving throws are available for your character yet.', controls);
}

function resultCard(game, scope, context, receipt, record = {}) {
  const pages = informationPages(receiptGroups(receipt));
  const page = record.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) fail();
  const base = { kind: 'check-result', revision: receipt.revision, requestId: receipt.requestId };
  const controls = [];
  if (page > 0) controls.push(bound(game, scope, context, { ...base, page: page - 1 }, 'Previous detail'));
  if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...base, page: page + 1 }, 'Next detail'));
  controls.push(HISTORY, HOME);
  return screen('Roll saved · Only you', `${safeText(pages[page].title)}\nDetail ${page + 1}/${pages.length}\n\n${safeText(pages[page].text)}\n\nThis is the saved result. Retrying the same confirmation does not roll again.`, controls);
}

/** Reads and previews are free. Only a bound, explicit confirmation resolves a check. */
export function createChecksHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    // Existing bound rpc roll pages remain supported by the companion adapter.
    if (typeof customId !== 'string' || !(customId.startsWith('rpk:') || customId === 'rpc:rolls')) return false;
    let deferred = false;
    const deliver = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      game.member(scope);
      if (interaction.type !== 3) fail();
      await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } });
      deferred = true;
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      if (customId === 'rpk:home' || customId === 'rpc:rolls') {
        const count = game.pendingChecks(scope).length;
        await deliver(screen('Checks & rolls · Only you', `${count} current check${count === 1 ? '' : 's'} ready to review. Read complete saved attacks, checks and saving throws here.\n\nLooking is free at any time. A new roll requires your explicit confirmation and follows the current scene, pause and action rules.`, [button('rpk:pending', 'Review pending checks'), HISTORY, MORE]));
      } else if (customId === 'rpk:pending') {
        await deliver(pendingCard(game, scope, context));
      } else if (customId === 'rpk:history') {
        await deliver(historyCard(game, scope, context));
      } else {
        const match = /^rpk:([a-f0-9]{24}):(page|confirm)$/.exec(customId);
        if (!match) fail();
        const record = game.control(scope, context, match[1]);
        if (match[2] === 'confirm') {
          if (record.kind !== 'check-confirm') fail();
          const receipt = game.resolveCheck(scope, { checkId: record.checkId, requestId: `discord-check-${match[1]}` });
          await deliver(resultCard(game, scope, context, receipt, { confirmId: match[1] }));
        } else if (record.kind === 'check-preview') {
          await deliver(pendingCard(game, scope, context, record));
        } else if (record.kind === 'roll-history') {
          await deliver(historyCard(game, scope, context, record));
        } else if (record.kind === 'check-result') {
          if (!Number.isSafeInteger(record.revision) || record.revision < 1) fail();
          const receipt = game.rollHistory(scope, record.revision + 1).receipts.find(value => value.revision === record.revision && value.requestId === record.requestId);
          if (!receipt) fail();
          await deliver(resultCard(game, scope, context, receipt, record));
        } else fail();
      }
    } catch (error) {
      log({ outcome: 'checks_interaction_failed', code: error?.code || 'INTERNAL' });
      const message = error instanceof GameError ? error.message : 'The request could not be completed. If you confirmed a roll, retry that same confirmation or open Saved roll history before trying a new roll.';
      const data = screen('Checks & rolls · Only you', safeText(message || 'These controls are no longer current. Open Checks & rolls again.'), [HOME, HISTORY]);
      try {
        if (deferred) await deliver(data);
        else await transport.respond(interaction.id, interaction.token, { type: 4, data: { ...data, flags: 32768 | 64 } });
      } catch { log({ outcome: 'checks_delivery_failed' }); }
    }
    return true;
  };
}
