import { informationPages } from './companion-adapter.mjs';
import { screen, safeText } from './import-ui.mjs';

const group = (title, fields) => ({ title, fields: Object.entries(fields).map(([label, value]) => ({ label, value })) });
export function missionPages(world) {
  return informationPages([
    group('Mission', { Title: world.mission.title, Briefing: world.mission.briefing, Status: world.mission.status, 'World revision': world.revision }),
    group('Campaign tracks', Object.fromEntries(world.tracks.map(t => [`${t.label} (${t.id})`, `${t.value}/100`]))),
    ...(world.outcome ? [group('Recorded outcome', { Summary: world.outcome.summary, Source: world.outcome.source })] : []),
    ...(world.debrief ? [group('Party debrief', { Notes: world.debrief.notes || 'Recorded without additional notes.' })] : []),
    ...(world.nextMission ? [group('Selected next mission', { Title: world.nextMission.title, Summary: world.nextMission.summary, Cost: world.nextMission.cost, Status: world.nextMission.status })] : []),
  ]);
}
export function councilPages(round) {
  return informationPages([
    group('Mission council', { Round: round.round, 'World evidence revision': round.worldRevision, 'Tie policy': round.tieBreak, 'Saved packet': round.packetHash,
      'Council lead': round.branches.find(b => b.id === round.leadingId)?.title,
      'Party selection': round.selection ? round.branches.find(b => b.id === round.selection.branchId)?.title : 'Awaiting the party’s explicit choice' }),
    ...round.branches.map(b => group(b.title, { Summary: b.summary, Cost: b.cost, Total: round.totals.find(t => t.branchId === b.id)?.score })),
    ...round.members.flatMap(m => [group(m.name, { Mandate: m.mandate, Weight: m.weight }), ...m.assessments.map(a => group(`${m.name} · ${round.branches.find(b => b.id === a.branchId)?.title}`, {
      Score: a.score, Assessment: a.assessment, Evidence: a.evidence.join(', '),
    }))]),
  ], ['Five equal-weight deterministic personas assess reviewed branches from the same saved world packet. Their lead is advice; the party chooses. Selecting a branch records the choice. Use the mission card for current progress and Next scene for any prepared departure.']);
}

/** Transport-sized pages retain the entire authorized source; controls carry
 * only a revision and cursor, never an independent copy of campaign state. */
export function worldPageCard({ game, scope, context, prefix, record, title, pages, controls = [] }) {
  const page = Math.min(Math.max(0, record.page ?? 0), pages.length - 1);
  const nav = (label, next, disabled) => {
    const id = game.createControl(scope, context, { ...record, page: Math.min(Math.max(0, next), pages.length - 1) });
    return { type: 2, custom_id: `${prefix}:${id}:page`, label, style: 2, disabled };
  };
  return screen(title, `Page ${page + 1}/${pages.length} · ${safeText(pages[page].title)}\n\n${safeText(pages[page].text)}`,
    [nav('Previous page', page - 1, page === 0), nav('Next page', page + 1, page === pages.length - 1), ...controls]);
}
