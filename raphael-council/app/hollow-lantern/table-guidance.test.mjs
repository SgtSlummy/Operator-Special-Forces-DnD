import test from 'node:test';
import assert from 'node:assert/strict';
import {journalEntries,choiceGuidance,recoveryGuidance} from './table-guidance.mjs';

test('journal uses authorized current-scene title, without inventing other discoveries', () => {
  const view={sceneId:'briefing',title:'Vesper Quay · Mission briefing',journal:['Discovered: Location:briefing','Discovered: Location:coastal-road','Awaiting ruling: Look inside','Discovered: clue:sealed']};
  assert.deepEqual(journalEntries(view),['Discovered location: Vesper Quay · Mission briefing','Discovered location: Coastal road','Awaiting ruling: Look inside','Discovered: clue:sealed']);
  assert.equal(view.journal[0],'Discovered: Location:briefing');
  assert.deepEqual(journalEntries({sceneId:'secret',title:'Hidden chamber'}),[]);
  assert.deepEqual(journalEntries({sceneId:'secret',title:'Hidden chamber',journal:['Discovered: Location:briefing']}),['Discovered location: Briefing']);
});

test('paused player receives waiting guidance, GM receives review-before-confirm guidance', () => {
  const player=choiceGuidance({summary:'The DM is preparing the scene. Decisions are paused.\nMara · 31 HP'});
  assert.match(player,/while you wait/);assert.doesNotMatch(player,/select Open decisions/);
  assert.match(choiceGuidance({dmStatus:{decisionOpen:false}}),/before confirming/);
  assert.match(choiceGuidance({dmStatus:{decisionOpen:true}}),/Nothing is submitted until/);
});

test('recovery guidance names the actual receipt control and distinguishes refresh', () => {
  assert.match(recoveryGuidance,/Recover original action/);
  assert.match(recoveryGuidance,/without repeating the action/);
  assert.match(recoveryGuidance,/Refresh reloads the view; it does not recover a receipt/);
});
