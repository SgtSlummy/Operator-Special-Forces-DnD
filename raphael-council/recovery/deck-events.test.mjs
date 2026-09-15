import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAgentProposals, createDeckStep, createObusProposalAdapter, fallbackProposal, projectionMarker } from './deck-events.mjs';

const snapshot = { gameRevision: 4, action: { type: 'move', actorId: 'branna' } };

test('agent proposals run in parallel and fall back independently', async () => {
  const started = [];
  const proposals = await collectAgentProposals(snapshot, { timeoutMs: 50, propose: async ({ role }) => {
    started.push(role);
    if (role === 'enemy') throw new Error('offline');
    await new Promise(resolve => setTimeout(resolve, 5));
    return { summary: `${role} proposal` };
  }});
  assert.equal(proposals.length, 9);
  assert.deepEqual(started.sort(), ['character', 'detail', 'dm', 'enemy', 'movement', 'overseer', 'story', 'terrain', 'visibility']);
  assert.equal(proposals.find(p => p.role === 'enemy').status, 'fallback');
  assert.equal(proposals.find(p => p.role === 'dm').status, 'ready');
});

test('deck steps bind images and proposals to the same revision', () => {
  const step = createDeckStep({ index: 1, total: 2, view: { revision: 4, phase: 'combat', round: 1, turn: 1 }, scene: { id: 'shore', revision: 4, title: 'Shore', description: 'Visible shore' }, action: { type: 'move' }, buttons: ['Move'], actors: [], initiative: [], party: [], rulesComponents: {}, image: { phase: 'before', stateRevision: 4 }, afterImage: { phase: 'after', stateRevision: 4 }, proposals: [fallbackProposal('dm', snapshot)] });
  assert.equal(step.kind, 'DeckStep');
  assert.equal(step.image.stateRevision, step.gameRevision);
  assert.equal(step.afterImage.stateRevision, step.gameRevision);
  assert.equal(step.agentProposals[0].sourceRevision, step.gameRevision);
});

test('projection markers are stable and revision-specific', () => {
  assert.equal(projectionMarker('party', 4, 'event-1'), 'dmd-arcade:v4:party:r4:event-1');
});

test('Obus adapter sends only visible snapshot evidence and returns a compact proposal', async () => {
  let request;
  const adapter = createObusProposalAdapter({ scope: { campaign: 'party', owner: 'host', role: 'host' }, transport: { generate: async input => { request = input; return { text: 'Protect the courier and keep the visible lead open.', model: 'local-test', trace: [{ destination: 'local' }] }; } } });
  const proposal = await adapter({ role: 'dm', snapshot: { gameRevision: 3, action: { type: 'listen' }, location: { title: 'Shore' }, actors: [{ id: 'branna' }] } });
  assert.equal(proposal.provider, 'obus');
  assert.match(proposal.summary, /courier/);
  assert.equal(request.evidence.gameRevision, 3);
  assert.equal(request.evidence.visibleActors[0].id, 'branna');
});
