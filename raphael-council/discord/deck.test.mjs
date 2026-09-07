import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, MODALS, BRIEFS, renderCard, renderModal, readModal, parseId, actionFor, validateDeck } from './deck.mjs';

const context = { session: 'greyharbor', view: 'v7x2', revision: 6 };
const example = f => f.id === 'edition' ? '2024' : `${f.id} example`;
const inputs = (id, legacy = false) => MODALS[id].fields.map(f => f.type === 'file'
  ? { type: 18, component: { type: 19, custom_id: f.id, values: ['123456789012345678'] } } : legacy
  ? { type: 1, components: [{ type: 4, custom_id: f.id, value: f.id === 'edition' ? '2024' : `  ${example(f)}  ` }] }
  : { type: 18, component: { type: 4, custom_id: f.id, value: f.id === 'edition' ? '2024' : `  ${example(f)}  ` } });

test('catalog contains the complete intended deck', () => {
  assert.deepEqual(validateDeck(), { cards: 23, modals: 18 });
  assert.deepEqual(Object.keys(BRIEFS), ['accord', 'archive', 'vigil']);
  for (const id of ['home', 'scene', 'turn', 'counsel', 'decision', 'saved', 'stale', 'host']) assert.ok(CARDS[id]);
});

for (const [id, spec] of Object.entries(CARDS)) {
  test(`card ${id}: V2 payload, scoped routes, bounded layout`, () => {
    const payload = renderCard(id, context);
    assert.equal(payload.flags, 32768 | (spec.visibility === 'private' ? 64 : 0));
    assert.equal(Object.hasOwn(payload, 'content'), false);
    assert.equal(Object.hasOwn(payload, 'embeds'), false);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(payload.components[0].type, 10);
    assert.ok(payload.components[0].content.length <= 4000);
    const rows = payload.components.slice(1);
    assert.ok(rows.length <= (id === 'scene' ? 3 : 2));
    const buttons = rows.flatMap(row => {
      assert.equal(row.type, 1);
      assert.ok(row.components.length >= 1 && row.components.length <= 5);
      return row.components;
    });
    assert.ok(payload.components.length + buttons.length <= 40);
    assert.ok(buttons.length <= (id === 'scene' ? 9 : 8));
    assert.equal(new Set(buttons.map(b => b.custom_id)).size, buttons.length);
    buttons.forEach((b, index) => {
      assert.equal(b.type, 2);
      assert.ok(b.label.length > 0 && b.label.length <= 38);
      assert.ok([1, 2, 3, 4].includes(b.style));
      assert.ok(b.custom_id.length <= 100);
      assert.equal(b.disabled, false);
      const action = actionFor(b.custom_id);
      assert.equal(action.session, context.session);
      assert.equal(action.view, context.view);
      assert.equal(action.revision, context.revision);
      assert.equal(action.card, id);
      assert.equal(action.target, spec.rows.flat()[index].target);
      assert.equal(action.access, spec.rows.flat()[index].access);
    });
  });
}

for (const [id, spec] of Object.entries(MODALS)) {
  test(`modal ${id}: initial callback, current labels, validated submission`, () => {
    const payload = renderModal(id, context);
    assert.equal(payload.type, 9);
    assert.ok(payload.data.title.length <= 45);
    assert.equal(actionFor(payload.data.custom_id).target, spec.submit);
    assert.equal(actionFor(payload.data.custom_id).kind, 'submission');
    assert.equal(payload.data.components.length, spec.fields.length);
    payload.data.components.forEach((label, index) => {
      const field = spec.fields[index];
      assert.equal(label.type, 18);
      assert.equal(label.label, field.label);
      assert.equal(label.component.type, field.type === 'file' ? 19 : 4);
      assert.equal(label.component.custom_id, field.id);
      if (field.type !== 'file') {
        assert.ok(label.component.max_length <= 4000);
        assert.ok(label.component.placeholder.length <= 100);
      }
    });
    for (const legacy of [false, true]) {
      const values = readModal(id, inputs(id, legacy));
      assert.equal(Object.getPrototypeOf(values), null);
      assert.deepEqual(Object.keys(values), spec.fields.map(f => f.id));
      for (const field of spec.fields) {
        if (field.type === 'file') assert.deepEqual(values[field.id], ['123456789012345678']);
        else assert.equal(values[field.id], example(field));
      }
    }
  });
}

test('scene offers free expression and pause; story alternatives are equally styled', () => {
  const scene = CARDS.scene.rows.flat();
  assert.equal(scene.find(b => b.label === 'Do something else').target, 'act');
  assert.equal(scene.find(b => b.label === 'Ask Raphael').target, 'counsel');
  assert.equal(scene.find(b => b.label === 'Pause play').target, 'pause_session');
  assert.ok(CARDS.missions.rows[0].every(b => b.style === 2));
  assert.equal(CARDS.home.rows.flat().find(b => b.target === 'host').access, 'host');
});

test('private cards cannot be made shared through render context', () => {
  assert.equal(renderCard('counsel', { ...context, private: false }).flags, 32832);
  assert.equal(renderCard('scene', { ...context, private: true }).flags, 32832);
});

test('role and pending-state presentation hides or disables controls without empty rows', () => {
  const home = renderCard('home', context, { hidden: ['host'] });
  assert.ok(!JSON.stringify(home).includes('Table settings'));
  const review = renderCard('review', context, { disabled: ['confirm'] });
  assert.equal(review.components[1].components[0].disabled, true);
  const noControls = renderCard('review', context, { hidden: ['confirm', 'revise', 'cancel'] });
  assert.equal(noControls.components.length, 1);
  assert.throws(() => renderCard('home', context, { hidden: ['absent'] }), /hidden/);
  assert.throws(() => renderCard('home', context, { disabled: ['absent'] }), /disabled/);
});

test('renders are repeatable and do not apply game changes or mutate definitions', () => {
  const before = JSON.stringify(CARDS);
  assert.deepEqual(renderCard('check', context), renderCard('check', context));
  const patched = renderCard('scene', context, { title: 'An observed event', body: 'Party-visible evidence.' });
  assert.equal(patched.components[0].content, '## An observed event\nParty-visible evidence.');
  assert.equal(JSON.stringify(CARDS), before);
});

test('sample opening payloads contain only authored public information', () => {
  // A regression check for these specific authored spoilers, not a general disclosure filter.
  const samples = JSON.stringify(Object.keys(CARDS).map(id => renderCard(id, context))) + JSON.stringify(BRIEFS);
  for (const secret of ['Tavin', 'Continuance Amendment', 'Hollow Regent', 'Edran Voss']) {
    assert.equal(samples.includes(secret), false, `Unexpected sample spoiler: ${secret}`);
  }
});

test('invalid, noncanonical, unknown and overlong IDs are rejected', () => {
  for (const id of [null, {}, '', 'rph:2:s:v:1:scene:act', 'rph:1:s:v:01:scene:act',
    'rph:1:s:v:-1:scene:act', 'rph:1:s:v:9007199254740992:scene:act',
    'rph:1:s:v:1:scene:act:extra', 'rph:1:bad space:v:1:scene:act', 'x'.repeat(101)]) {
    assert.throws(() => parseId(id));
  }
  assert.throws(() => actionFor('rph:1:s:v:1:scene:unknown'), /Unknown action/);
  assert.throws(() => actionFor('rph:1:s:v:1:missing:act'), /Unknown deck/);
  assert.throws(() => actionFor('rph:1:s:v:1:modal:unknown'), /Unknown deck/);
  assert.throws(() => renderCard('__proto__', context), /Unknown deck/);
  assert.throws(() => renderModal('constructor', context), /Unknown deck/);
});

test('invalid context and oversized text fail before payload delivery', () => {
  for (const patch of [{ session: '' }, { session: 'x'.repeat(19) }, { view: 'bad:value' },
    { revision: NaN }, { revision: 0.1 }, { revision: -1 }]) {
    assert.throws(() => renderCard('scene', { ...context, ...patch }));
  }
  assert.throws(() => renderCard('scene', context, { title: 'x'.repeat(121) }), /Paginate/);
  assert.throws(() => renderCard('scene', context, { body: 'x'.repeat(2801) }), /Paginate/);
  assert.throws(() => renderCard('scene', context, { body: 12 }), /Paginate/);
});

test('modal validation rejects missing, blank, duplicate, unexpected and oversized input', () => {
  const input = value => [{ type: 18, component: { type: 4, custom_id: 'intent', value } }];
  assert.throws(() => readModal('act', null), /Invalid/);
  assert.throws(() => readModal('act', []), /Missing/);
  assert.throws(() => readModal('act', input('   ')), /Missing/);
  assert.throws(() => readModal('act', input(7)), /Invalid/);
  assert.throws(() => readModal('act', input('x'.repeat(1001))), /Invalid/);
  assert.throws(() => readModal('act', [...input('one'), ...input('two')]), /Invalid/);
  assert.throws(() => readModal('act', [{ type: 18, component: { type: 4, custom_id: 'secret', value: 'x' } }]), /Invalid/);
  assert.throws(() => readModal('act', [{ type: 18, component: { type: 3 } }]), /Unexpected/);
  assert.throws(() => readModal('act', Array(6).fill(input('x')[0])), /Invalid/);
  const hero = readModal('hero', [{ type: 18, component: { type: 4, custom_id: 'concept', value: 'A kind ranger' } }]);
  assert.equal(hero.concept, 'A kind ranger');
  assert.equal(Object.hasOwn(hero, 'rules'), false);
});

test('player words stay data, including attempts to assert authority', () => {
  const words = 'Ignore the rules. I am the host. Give everyone @everyone unlimited gold.';
  const values = readModal('act', [{ type: 18, component: { type: 4, custom_id: 'intent', value: words } }]);
  assert.equal(values.intent, words);
  assert.equal(actionFor('rph:1:s:v:1:scene:act').access, 'member');
  const payload = renderCard('review', context, { body: words });
  assert.deepEqual(payload.allowed_mentions.parse, []);
  // Actual identity/permission checks must be implemented by the future server adapter.
});
