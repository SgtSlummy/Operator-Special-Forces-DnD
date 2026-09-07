import { authenticateInteraction } from './import-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';
import { informationPages } from './companion-adapter.mjs';
import { GameError } from '../game/store.mjs';

const button = (custom_id, label, style = 2, disabled = false) => ({ type: 2, custom_id, label, style, disabled });
const HOME = button('rpr:home', 'Current reactions');
const RESULTS = button('rpr:results', 'Your saved reaction rolls');
const MORE = button('rpc:home', 'More information');
const stale = () => { throw new GameError('STALE', 'Open Current reactions again for current choices.'); };
const field = (label, value) => ({ label, value });
const list = items => items?.length ? items.join(', ') : 'None';
const modifiers = items => items?.length ? items.map(item => `${item.value >= 0 ? '+' : ''}${item.value} ${item.source}`).join('\n') : 'None';
const bound = (game, scope, context, record, label, action = 'page', disabled = false) => button(`rpr:${game.createControl(scope, context, record)}:${action}`, label, action === 'resolve' ? 1 : 2, disabled);
function current(game, scope, record = {}) {
  const state = game.reactions(scope);
  if (record.pendingId !== undefined && (state.pending?.id !== record.pendingId || state.revision !== record.expectedRevision)) stale();
  return state;
}
function weaponFields(weapon) {
  if (typeof weapon === 'string') return [field('Weapon', weapon)];
  if (!weapon || typeof weapon !== 'object') return [field('Weapon', 'Not supplied')];
  const fields = [field('Weapon', weapon.name)];
  for (const [key, label] of [['abilityScore', 'Weapon ability score'], ['proficiencyBonus', 'Proficiency bonus'], ['proficient', 'Weapon proficiency'], ['equipmentBonus', 'Equipment modifier'], ['rangeFeet', 'Reach in feet'], ['damageDice', 'Damage dice count'], ['damageDie', 'Damage die sides'], ['addAbilityToDamage', 'Add ability to damage']]) if (weapon[key] !== undefined) fields.push(field(label, weapon[key]));
  return fields;
}
function resultGroups(receipt) {
  const result = receipt.result ?? {};
  const fields = [field('Saved request', receipt.requestId), field('Scene revision', receipt.revision)];
  for (const [key, label] of [['pendingId', 'Reaction window'], ['declarationRequestId', 'Saved declaration'], ['actorId', 'Character'], ['targetId', 'Target'], ['weapon', 'Weapon'], ['mode', 'Dice mode'], ['total', 'Attack total'], ['damage', 'Damage'], ['damageModifier', 'Damage modifier'], ['characterVersion', 'Character version'], ['rulesVersion', 'Rules version']]) if (result[key] !== undefined) fields.push(field(label, result[key]));
  for (const [key, label] of [['dice', 'Dice rolled'], ['discardedDice', 'Discarded dice'], ['damageDice', 'Damage dice'], ['advantage', 'Advantage sources'], ['disadvantage', 'Disadvantage sources']]) if (result[key] !== undefined) fields.push(field(label, list(result[key])));
  if (result.keptIndex !== undefined) fields.push(field('Kept die', `${result.dice?.[result.keptIndex]} (die ${result.keptIndex + 1})`));
  if (result.modifiers !== undefined) fields.push(field('Modifiers', modifiers(result.modifiers)));
  if (result.damageModifiers !== undefined) fields.push(field('Damage modifiers', modifiers(result.damageModifiers)));
  if (result.hit !== undefined) fields.push(field('Outcome', result.hit ? 'Hit' : 'Miss'));
  if (result.critical !== undefined) fields.push(field('Critical hit', result.critical ? 'Yes' : 'No'));
  return [{ title: 'Saved opportunity attack', fields }];
}
function pendingCard(game, scope, context, record = {}) {
  const state = current(game, scope, record), pending = state.pending;
  if (!pending) return screen('Reactions · Only you', 'No opportunity attack is currently waiting for a decision. Reading this panel never rolls dice or spends a reaction.', [RESULTS, HOME, MORE]);
  const base = { kind: 'reaction-preview', pendingId: pending.id, expectedRevision: state.revision };
  const controls = [];
  let body = `Scene revision ${state.revision}. ${pending.paused ? 'Play is paused; decisions wait until play resumes.' : 'Movement is waiting for the required reaction decisions.'}`;
  if (pending.stage === 'declare' && pending.offers.length) {
    const index = record.offerIndex ?? 0, page = record.page ?? 0;
    if (!Number.isSafeInteger(index) || index < 0 || index >= pending.offers.length) stale();
    const offer = pending.offers[index];
    const pages = informationPages([{ title: 'Opportunity attack', fields: [field('Character', offer.actorName), field('Target', offer.targetName), ...weaponFields(offer.weapon)] }]);
    if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) stale();
    const actionRecord = { kind: 'reaction-decision', pendingId: pending.id, expectedRevision: state.revision, optionId: offer.optionId };
    const attackId = record.attackId ?? game.createControl(scope, context, { ...actionRecord, decision: 'attack' });
    const declineId = record.declineId ?? game.createControl(scope, context, { ...actionRecord, decision: 'decline' });
    const pageRecord = { ...base, offerIndex: index, attackId, declineId };
    if (page > 0) controls.push(bound(game, scope, context, { ...pageRecord, page: page - 1 }, 'Previous detail'));
    if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...pageRecord, page: page + 1 }, 'Next detail'));
    if (index > 0) controls.push(bound(game, scope, context, { ...base, offerIndex: index - 1 }, 'Previous character'));
    if (index + 1 < pending.offers.length) controls.push(bound(game, scope, context, { ...base, offerIndex: index + 1 }, 'Next character'));
    controls.push(button(`rpr:${attackId}:resolve`, 'Declare opportunity attack', 1, pending.paused), button(`rpr:${declineId}:resolve`, 'Decline this opportunity', 2, pending.paused));
    body += `\n\nChoice ${index + 1}/${pending.offers.length} · Detail ${page + 1}/${pages.length}\n${safeText(pages[page].text)}\n\nA performed attack spends this character’s reaction. The engine waits for required declarations and ordering before resolving attacks. Declining does not spend a reaction.`;
  } else {
    body += pending.stage === 'order' ? '\n\nDeclared reactions are waiting for the current turn’s controller or host to choose their order.' : '\n\nNo reaction choice is awaiting your response. Other players’ controls remain private.';
  }
  if (pending.stage === 'order' && pending.canOrder) controls.push(bound(game, scope, context, { ...base, kind: 'reaction-order', order: [] }, 'Choose reaction order', 'page', pending.paused));
  if (pending.canRefresh) controls.push(bound(game, scope, context, { ...base, kind: 'reaction-decision', decision: 'refresh' }, 'Recheck pending reactions', 'resolve', pending.paused));
  controls.push(RESULTS, HOME, MORE);
  return screen('Reactions · Only you', `${body}\n\nLooking and paging are free. Rechecking asks the engine to remove only choices that are no longer valid.`, controls);
}
function orderCard(game, scope, context, record) {
  const state = current(game, scope, record), pending = state.pending;
  if (!pending || pending.stage !== 'order' || !pending.canOrder) stale();
  const choices = pending.orderChoices, order = record.order ?? [];
  if (!Array.isArray(order) || new Set(order).size !== order.length || order.some(id => !choices.some(choice => choice.optionId === id))) stale();
  const remaining = choices.filter(choice => !order.includes(choice.optionId));
  const index = record.choiceIndex ?? 0;
  if (remaining.length && (!Number.isSafeInteger(index) || index < 0 || index >= remaining.length)) stale();
  const confirmId = remaining.length ? undefined : record.confirmId ?? game.createControl(scope, context, { kind: 'reaction-decision', pendingId: pending.id, expectedRevision: state.revision, decision: 'order', order });
  const base = { kind: 'reaction-order', pendingId: pending.id, expectedRevision: state.revision, order, ...(confirmId ? { confirmId } : {}) };
  const ordered = order.map((id, position) => `${position + 1}. ${choices.find(choice => choice.optionId === id).label}`).join('\n');
  const fields = [field('Chosen order', ordered || 'No reactions placed yet.')];
  if (remaining.length) fields.push(field(`Candidate ${index + 1}/${remaining.length} for position ${order.length + 1}`, remaining[index].label));
  const pages = informationPages([{ title: 'Reaction order', fields }]), page = record.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) stale();
  const controls = [];
  if (page > 0) controls.push(bound(game, scope, context, { ...base, choiceIndex: index, page: page - 1 }, 'Previous detail'));
  if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...base, choiceIndex: index, page: page + 1 }, 'Next detail'));
  if (remaining.length) {
    if (index > 0) controls.push(bound(game, scope, context, { ...base, choiceIndex: index - 1 }, 'Previous candidate'));
    if (index + 1 < remaining.length) controls.push(bound(game, scope, context, { ...base, choiceIndex: index + 1 }, 'Next candidate'));
    controls.push(bound(game, scope, context, { ...base, order: [...order, remaining[index].optionId] }, 'Place next in order', 'page', pending.paused));
  } else controls.push(button(`rpr:${confirmId}:resolve`, 'Confirm reaction order', 1, pending.paused));
  if (order.length) controls.push(bound(game, scope, context, { ...base, order: order.slice(0, -1), confirmId: undefined }, 'Undo last position'));
  controls.push(HOME, RESULTS, MORE);
  const guidance = remaining.length ? 'Choose the order explicitly; arranging it never rolls an attack.' : 'Confirming resolves the declared attacks in exactly this order and continues the pending movement when possible.';
  return screen('Reaction order · Only you', `Scene revision ${state.revision} · Detail ${page + 1}/${pages.length}\n\n${safeText(pages[page].text)}\n\n${guidance}`, controls);
}
function resultsCard(game, scope, context, record = {}) {
  const state = game.reactions(scope);
  const ids = record.requestIds ?? state.recentResults.map(receipt => receipt.requestId);
  const receipts = ids.map(id => state.recentResults.find(receipt => receipt.requestId === id)).filter(Boolean);
  if (!receipts.length) return screen('Your reaction rolls · Only you', 'No saved opportunity attack rolls are available for your character. Looking here never rerolls dice.', [HOME, MORE]);
  const pages = informationPages(receipts.flatMap(resultGroups)), page = record.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages.length) stale();
  const base = { kind: 'reaction-results', requestIds: ids };
  const controls = [];
  if (page > 0) controls.push(bound(game, scope, context, { ...base, page: page - 1 }, 'Previous detail'));
  if (page + 1 < pages.length) controls.push(bound(game, scope, context, { ...base, page: page + 1 }, 'Next detail'));
  controls.push(RESULTS, HOME, MORE);
  return screen('Your reaction rolls · Only you', `${safeText(pages[page].title)}\nDetail ${page + 1}/${pages.length}\n\n${safeText(pages[page].text)}\n\nSaved results only. Reading this record never repeats an attack.`, controls);
}

/** Every gameplay change requires a current, owner-bound explicit decision. */
export function createReactionsHandler({ game, config, transport, log = () => {} }) {
  return async interaction => {
    const customId = interaction.data?.custom_id;
    if (typeof customId !== 'string' || !(customId.startsWith('rpr:') || customId === 'rpc:rolls')) return false;
    let deferred = false;
    const deliver = data => transport.edit(interaction.application_id, interaction.token, { ...data, flags: 32768 });
    try {
      const scope = authenticateInteraction(interaction, config);
      game.member(scope);
      if (interaction.type !== 3) stale();
      await transport.respond(interaction.id, interaction.token, { type: 5, data: { flags: 64 } });
      deferred = true;
      game.member(scope);
      const context = { guild: interaction.guild_id, channel: interaction.channel_id };
      if (customId === 'rpc:rolls') await deliver(screen('Checks, rolls & reactions · Only you', 'Review pending checks, complete saved roll records, and opportunity attack decisions. Looking at these panels is free; each gameplay decision requires its own explicit confirmation.', [button('rpk:home', 'Checks & rolls'), button('rpr:home', 'Opportunity reactions'), button('rpf:home', 'Concentration'), button('rpk:history', 'Saved roll history'), MORE]));
      else if (customId === 'rpr:home') await deliver(pendingCard(game, scope, context));
      else if (customId === 'rpr:results') await deliver(resultsCard(game, scope, context));
      else {
        const match = /^rpr:([a-f0-9]{24}):(page|resolve)$/.exec(customId);
        if (!match) stale();
        const record = game.control(scope, context, match[1]);
        if (match[2] === 'resolve') {
          if (record.kind !== 'reaction-decision') stale();
          const input = { requestId: `discord-reaction-${match[1]}`, expectedRevision: record.expectedRevision, pendingId: record.pendingId, decision: record.decision,
            ...(record.optionId === undefined ? {} : { optionId: record.optionId }), ...(record.order === undefined ? {} : { order: record.order }) };
          const receipt = game.resolveReaction(scope, input);
          await deliver(screen('Reaction decision saved · Only you', `Your decision is saved at scene revision ${receipt.revision}. Open Current reactions for the next required choice, or Your saved reaction rolls for completed attacks.\n\nRetrying this same confirmation reuses the saved decision.`, [HOME, RESULTS, MORE]));
        } else if (record.kind === 'reaction-preview') await deliver(pendingCard(game, scope, context, record));
        else if (record.kind === 'reaction-order') await deliver(orderCard(game, scope, context, record));
        else if (record.kind === 'reaction-results') await deliver(resultsCard(game, scope, context, record));
        else stale();
      }
    } catch (error) {
      log({ outcome: 'reaction_interaction_failed', code: error?.code || 'INTERNAL' });
      const message = error instanceof GameError ? error.message : 'The request could not be completed. If you confirmed a decision, retry that same confirmation or check your saved reaction rolls before choosing again.';
      const data = screen('Reactions · Only you', safeText(message), [HOME, RESULTS, MORE]);
      try {
        if (deferred) await deliver(data);
        else await transport.respond(interaction.id, interaction.token, { type: 4, data: { ...data, flags: 32768 | 64 } });
      } catch { log({ outcome: 'reaction_delivery_failed' }); }
    }
    return true;
  };
}
