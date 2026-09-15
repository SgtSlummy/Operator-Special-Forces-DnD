const ROLE_LABELS = Object.freeze({
  character: 'Character agent',
  enemy: 'Enemy controller',
  story: 'Story guide',
  dm: 'Auto-DM',
  overseer: 'Game overseer',
  detail: 'Detail adjudicator',
  terrain: 'Terrain & cover agent',
  movement: 'Movement rules agent',
  visibility: 'Visibility agent',
});

import { ObusTransport } from '../ai/obus.mjs';
import { TACTICAL_AGENT_CONTRACTS } from './tactical-terrain-agent.mjs';

const AGENT_CONTRACTS = Object.freeze({
  ...TACTICAL_AGENT_CONTRACTS,
  character: { label: 'Character agent', job: 'Choose a safe action from the visible objective and confirmed character abilities.' },
  enemy: { label: 'Enemy controller', job: 'Resolve visible enemy pressure without exposing hidden intent.' },
  story: { label: 'Story guide', job: 'Keep the visible lead and scene continuity coherent.' },
  dm: { label: 'Auto-DM', job: 'Apply the current rules snapshot and frame the next readable deck.' },
  overseer: { label: 'Game overseer', job: 'Check revision, visibility, resources, and receipt before publishing.' },
  detail: { label: 'Detail adjudicator', job: 'Set player-facing detail from the confirmed roll, modifiers, buffs, and story urgency.' },
});

const ACTION_LABELS = Object.freeze({
  accept_characters: 'Accept Character',
  listen: 'Listen',
  move: 'Move',
  attack: 'Attack',
  end_turn: 'End Turn',
  help_the_courier: 'Help the Courier',
  decision: 'Carry the Seal',
});

function text(value, fallback = '') { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }

export function actionLabel(action) { return ACTION_LABELS[action?.type] || text(action?.type, 'Open deck'); }

export function fallbackProposal(role, snapshot) {
  const action = actionLabel(snapshot.action);
  const actor = snapshot.action?.actorId ? ` for ${snapshot.action.actorId}` : '';
  const messages = {
    character: `Keep the party together and resolve the visible objective${actor}.`,
    enemy: snapshot.action?.type === 'attack' ? 'Protect the brine line and pressure the nearest hero.' : 'Hold position until a threat enters reach.',
    story: snapshot.action?.type === 'decision' ? 'Follow the evidence toward the records room.' : 'Make the visible lead clearer without revealing hidden information.',
    dm: `Resolve ${action}${actor} using the current rules snapshot.`,
    overseer: 'Check the revision, visibility, resources, and receipt before publishing the result.',
    detail: 'Set player-facing detail from the confirmed roll, character modifiers, buffs, and story urgency.',
    terrain: 'Classify visible cells for cover, concealment, elevation, stairs, and blocked structure.',
    movement: 'Reject blocked paths and require a staircase for any level change.',
    visibility: 'Publish only tactical facts and actors visible to the current viewer.',
  };
  return { role, label: ROLE_LABELS[role] || role, status: 'fallback', action, summary: messages[role] || 'Use only confirmed visible facts.', confidence: 'deterministic', sourceRevision: snapshot.gameRevision };
}

export async function collectAgentProposals(snapshot, { roles = Object.keys(ROLE_LABELS), propose = null, timeoutMs = 1200 } = {}) {
  const run = async role => {
    const fallback = fallbackProposal(role, snapshot);
    if (typeof propose !== 'function') return fallback;
    try {
      const result = await Promise.race([
        Promise.resolve(propose({ role, snapshot: structuredClone(snapshot) })),
        new Promise((_, reject) => setTimeout(() => reject(new Error('proposal timeout')), timeoutMs)),
      ]);
      if (!result || typeof result.summary !== 'string' || !result.summary.trim()) return fallback;
      return { ...fallback, ...result, role, label: ROLE_LABELS[role] || result.label || role, status: 'ready', sourceRevision: snapshot.gameRevision };
    } catch { return fallback; }
  };
  return Promise.all(roles.map(run));
}

export function createObusProposalAdapter({ transport = new ObusTransport(), scope, session = 'party-deck', policy = { mode: 'local', codex: false, exportable: false }, timeoutMs = 1200 } = {}) {
  if (!scope?.campaign || !scope?.owner || !scope?.role) throw new Error('Obus proposal adapter requires an authorized campaign scope.');
  return async ({ role, snapshot }) => {
    const result = await transport.generate({
      instructions: `You are the ${ROLE_LABELS[role] || role} for a tabletop game. Your job: ${AGENT_CONTRACTS[role]?.job || 'use only confirmed visible facts.'} Return one short human-readable proposal summary. Do not reveal hidden information, invent a roll, change state, or include private chain-of-thought.`,
      evidence: { role, gameRevision: snapshot.gameRevision, action: snapshot.action, location: snapshot.location, visibleActors: snapshot.actors },
      scope, task: role === 'story' ? 'narration' : role === 'dm' ? 'intent' : 'summary', session,
      requestId: `deck-${snapshot.gameRevision}-${role}`, policy, maxTokens: 240, signal: AbortSignal.timeout(timeoutMs),
    });
    return { summary: result.text.trim().slice(0, 320), provider: 'obus', model: result.model || null, trace: result.trace || [] };
  };
}

export function createDeckStep({ index, total, view, scene, action, notes = {}, buttons, actors, initiative, party, rulesComponents, image, afterImage, detail = null, tactical = null, proposals = [] }) {
  if (!Number.isSafeInteger(view?.revision) || view.revision < 0) throw new Error('Deck step requires a valid game revision.');
  return Object.freeze({
    kind: 'DeckStep', version: 1, step: index, total, screen: text(notes.screen, 'Campaign deck'),
    gameRevision: view.revision, sceneRevision: scene?.revision ?? view.revision, phase: view.phase, round: view.round, turn: view.turn,
    location: { id: scene?.id, title: scene?.title, description: scene?.description },
    action: structuredClone(action), notes: structuredClone(notes), buttons: [...buttons], actors: structuredClone(actors), initiative: structuredClone(initiative),
    party: structuredClone(party), rulesComponents: structuredClone(rulesComponents), image: structuredClone(image), afterImage: structuredClone(afterImage),
    detail: structuredClone(detail),
    tactical: structuredClone(tactical),
    agentProposals: proposals.map(proposal => structuredClone(proposal)),
  });
}

export function projectionMarker(campaign, revision, eventId = `step-${revision}`) {
  return `dmd-arcade:v4:${campaign}:r${revision}:${eventId}`;
}

export const ROLE_LABELS_PUBLIC = ROLE_LABELS;
