import test from 'node:test';
import assert from 'node:assert/strict';
import { createAllocationDraft, checkAllocationDraft, setAllocation, handleAllocation } from './healing-allocation.mjs';
import { ControlStore, createHollowLanternAdapter } from './adapter.mjs';
const scope = { campaignId: 'fixture', userId: 'owner', actorId: 'cleric', audience: 'player' };
const field = { id: 'allocations', kind: 'healing-allocation', label: 'Divide healing', maxLength: 4000, pool: 15,
  choices: [{ id: 'a', label: 'Mara' }, { id: 'b', label: 'Kestrel' }] };
const action = { id: 'preserve-life', label: 'Preserve Life', group: 'ability', fields: [field], payload: {} };
test('allocation edits replace a target, conserve budget and reject invalid amounts without mutation', () => {
  const d = createAllocationDraft(field, scope, 2, 100);
  setAllocation(d, 'a', '10'); setAllocation(d, 'a', '8'); setAllocation(d, 'b', '7');
  assert.deepEqual(d.entries, [{ targetId: 'a', amount: 8 }, { targetId: 'b', amount: 7 }]);
  for (const value of ['0', '-1', '1.5', '9', 'Infinity']) {
    const before = structuredClone(d); assert.throws(() => setAllocation(d, 'a', value)); assert.deepEqual(d, before);
  }
  assert.throws(() => setAllocation(d, 'unknown', '1'));
  assert.throws(() => checkAllocationDraft(d, { ...scope, userId: 'other' }, 2, d.version, 1));
  assert.throws(() => checkAllocationDraft(d, scope, 3, d.version, 1));
  assert.throws(() => checkAllocationDraft(d, scope, 2, d.version - 1, 1));
  assert.throws(() => checkAllocationDraft(d, scope, 2, d.version, 100));
});
function fixture({ projectedAction = action, failFirst = false } = {}) {
  let revision = 2, allowed = true, now = 1;
  const store = new ControlStore({ now: () => now }); const calls = [];
  const engine = { project: async () => ({ revision, audience: 'player', title: 'Private test', actions: [projectedAction] }),
    command: async request => { calls.push(request); if (failFirst && calls.length === 1) throw new Error('uncertain delivery'); return { revision: ++revision, result: { message: 'Applied' } }; } };
  const adapter = createHollowLanternAdapter({ engine, authorize: async s => allowed && s.userId === 'owner',
    resolveActor: async () => 'cleric', campaignId: 'fixture', tokenStore: store });
  const start = () => store.issue({ ...scope, revision, actionId: action.id, opensModal: true });
  async function press(id, options = {}) {
    const replies = []; const i = { customId: id, id: 'interaction', user: { id: options.owner ?? 'owner' }, values: options.values,
      isModalSubmit: () => options.amount !== undefined, fields: { getTextInputValue: () => options.amount },
      reply: async x => replies.push(x), editReply: async x => replies.push(x), deferReply: async x => { i.deferred = true; assert.equal(x.flags, 64); },
      showModal: async x => replies.push({ modal: x }) };
    assert.equal(await adapter.handleInteraction(i), true); return replies.at(-1);
  }
  return { store, calls, press, start, stale: () => revision++, revoke: () => allowed = false, expire: () => now = 9999999 };
}
const components = panel => panel.components.flatMap(c => c.components ?? [c]);
const button = (panel, name) => components(panel).find(c => c.label === name).custom_id;
const select = (panel, name) => components(panel).find(c => c.placeholder === name);
async function amount(f, panel, index, value) {
  const menu = select(panel, 'Add / edit healing target');
  const opened = await f.press(menu.custom_id, { values: [menu.options[index].value] });
  assert.equal(opened.modal.components.length, 1); assert.equal(opened.modal.components[0].component.custom_id, 'amount');
  return f.press(opened.modal.custom_id, { amount: value });
}
test('private native draft adds edits removes and cancels without any engine command', async () => {
  const f = fixture(); let panel = await f.press(f.start()); assert.ok(panel.flags & 64);
  panel = await amount(f, panel, 0, '8'); panel = await amount(f, panel, 1, '7');
  assert.match(JSON.stringify(panel), /Remaining HP: 0 \/ 15/);
  panel = await amount(f, panel, 0, '5'); assert.match(JSON.stringify(panel), /Remaining HP: 3 \/ 15/);
  const remove = select(panel, 'Remove healing target'); panel = await f.press(remove.custom_id, { values: [remove.options[1].value] });
  assert.match(JSON.stringify(panel), /Remaining HP: 10 \/ 15/);
  const confirm = button(panel, 'Confirm healing'); await f.press(button(panel, 'Cancel'));
  assert.match(JSON.stringify(await f.press(confirm)), /already confirmed or cancelled/); assert.equal(f.calls.length, 0);
});
test('uncertain command recovery preserves the exact confirmed intent', async () => {
  const f = fixture({ failFirst: true }); let panel = await f.press(f.start());
  panel = await amount(f, panel, 0, '8');
  const failed = await f.press(button(panel, 'Confirm healing'));
  assert.equal(f.calls.length, 1);
  f.stale();
  await f.press(button(failed, 'Recover original action'));
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], f.calls[0]);
  assert.deepEqual(JSON.parse(f.calls[1].payload.allocations), [{ targetId: 'a', amount: 8 }]);
});
test('target pagination keeps later targets reachable within Discord select limits', async () => {
  const choices = Array.from({ length: 30 }, (_, i) => ({ id: `target${i}`, label: `Ally ${i}` }));
  const f = fixture({ projectedAction: { ...action, fields: [{ ...field, choices }] } });
  let panel = await f.press(f.start());
  assert.equal(select(panel, 'Add / edit healing target').options.length, 25);
  panel = await f.press(button(panel, 'Next targets'));
  assert.equal(select(panel, 'Add / edit healing target').options.length, 5);
  panel = await amount(f, panel, 4, '3');
  assert.equal(select(panel, 'Add / edit healing target').options.length, 5);
  assert.equal(select(panel, 'Add / edit healing target').options[4].label, 'Ally 29');
  panel = await amount(f, panel, 4, '4');
  assert.equal(select(panel, 'Add / edit healing target').options.length, 5);
  const remove = select(panel, 'Remove healing target');
  panel = await f.press(remove.custom_id, { values: [remove.options[0].value] });
  assert.equal(select(panel, 'Add / edit healing target').options.length, 5);
  assert.equal(select(panel, 'Remove healing target'), undefined);
  panel = await amount(f, panel, 4, '3');
  await f.press(button(panel, 'Confirm healing'));
  assert.deepEqual(JSON.parse(f.calls[0].payload.allocations), [{ targetId: 'target29', amount: 3 }]);
});
test('only final confirmation sends JSON allocations once, repeated control uses original receipt', async () => {
  const f = fixture(); let panel = await f.press(f.start()); panel = await amount(f, panel, 0, '8');
  const old = button(panel, 'Confirm healing'); panel = await amount(f, panel, 1, '7');
  assert.match(JSON.stringify(await f.press(old)), /changed or expired/); assert.equal(f.calls.length, 0);
  const confirm = button(panel, 'Confirm healing'); await f.press(confirm); await f.press(confirm);
  assert.equal(f.calls.length, 1); assert.deepEqual(JSON.parse(f.calls[0].payload.allocations), [{ targetId: 'a', amount: 8 }, { targetId: 'b', amount: 7 }]);
  assert.equal(f.calls[0].expectedRevision, 2); assert.equal(f.calls[0].userId, 'owner');
});
test('wrong owner, stale revision, revoked access, expiry and copied modal cannot submit healing', async () => {
  for (const mode of ['owner', 'stale', 'revoked', 'expired']) {
    const f = fixture(); let panel = await f.press(f.start()); panel = await amount(f, panel, 0, '5'); const id = button(panel, 'Confirm healing');
    if (mode === 'stale') f.stale(); if (mode === 'revoked') f.revoke(); if (mode === 'expired') f.expire();
    await f.press(id, mode === 'owner' ? { owner: 'intruder' } : {}); assert.equal(f.calls.length, 0);
  }
  const f = fixture(), panel = await f.press(f.start()), menu = select(panel, 'Add / edit healing target');
  const modal = await f.press(menu.custom_id, { values: [menu.options[0].value] });
  assert.match(JSON.stringify(await f.press(modal.modal.custom_id, { amount: '3', owner: 'intruder' })), /another player/);
  assert.equal(f.calls.length, 0);
});
test('budget failure preserves draft and native component bounds are respected', async () => {
  const f = fixture(); let panel = await f.press(f.start()); panel = await amount(f, panel, 0, '10');
  const rejected = await amount(f, panel, 1, '6'); assert.match(JSON.stringify(rejected), /exceeds/);
  const final = await amount(f, panel, 1, '5');
  for (const row of final.components.filter(c => c.type === 1)) { assert.ok(row.components.length <= 5); for (const c of row.components) if (c.options) assert.ok(c.options.length <= 25); }
  await f.press(button(final, 'Confirm healing')); assert.equal(f.calls.length, 1);
});


test('invalid target pages reject before editing a draft', async () => {
  for (const page of [-1, 1, 0.5, '0', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const draft = createAllocationDraft(field, scope, 2, 100);
    const before = structuredClone(draft); const errors = [];
    await handleAllocation({ token: { healingAllocation: { draft, version: 0, op: 'amount', target: 'a', page } },
      action, scope, view: { revision: 2 }, interaction: { isModalSubmit: () => true, fields: { getTextInputValue: () => '3' } },
      tokenStore: { now: () => 1 }, send: async () => assert.fail('invalid page rendered'),
      reject: async message => errors.push(message), authorize: async () => true });
    assert.match(errors[0], /target page is unavailable/);
    assert.deepEqual(draft, before);
  }
});
