import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTacticalMap, evaluateTacticalPath, tacticalCell, TACTICAL_AGENT_CONTRACTS } from './tactical-terrain-agent.mjs';

const map = { width: 8, height: 7, blocked: [{ x: 3, y: 2 }], difficult: [{ x: 2, y: 1 }] };

test('terrain agent exposes cover, concealment, blocked structure, and a readable legend', () => {
  const tactical = analyzeTacticalMap({ map, locationId: 'saltglass-party-shore' });
  assert.equal(tacticalCell(tactical, 'B1').cover, 'full');
  assert.equal(tacticalCell(tactical, 'C2').concealment, 'light');
  assert.equal(tacticalCell(tactical, 'D3').blocked, true);
  assert.equal(tactical.legend.some(item => item.label === 'Cover'), true);
  assert.equal(tactical.legend.some(item => item.label === 'Stairs'), true);
});

test('movement agent requires stairs for elevation changes', () => {
  const tactical = analyzeTacticalMap({ map, locationId: 'abbey-archive' });
  const illegal = evaluateTacticalPath({ tactical, path: [{ x: 5, y: 2 }] });
  assert.equal(illegal.allowed, true);
  const stairs = tacticalCell(tactical, 'E3');
  assert.equal(stairs.requiresStairs, true);
  assert.equal(stairs.affordances.includes('use staircase'), true);
  const levelJump = evaluateTacticalPath({ tactical, path: [{ x: 1, y: 2 }, { x: 5, y: 2 }] });
  assert.equal(levelJump.allowed, false);
  assert.match(levelJump.failures.join(' '), /staircase/);
  assert.equal(TACTICAL_AGENT_CONTRACTS.movement.label, 'Movement rules agent');
});

test('tactical agent rejects a blocked path before a GameStore command is submitted', () => {
  const tactical = analyzeTacticalMap({ map, locationId: 'saltglass-party-shore' });
  const result = evaluateTacticalPath({ tactical, path: [{ x: 3, y: 2 }] });
  assert.equal(result.allowed, false);
  assert.match(result.failures.join(' '), /blocked structure/);
});
