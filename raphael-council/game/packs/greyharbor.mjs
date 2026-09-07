// Server/host content. Never import the complete proposal into a player bundle.
// Canonical sources and proposed mechanics are separated in the returned review record.
const council = (aster, mnemos, seren, kael, mira) => ({ aster, mnemos, seren, kael, mira });
const outcome = (id, title, summary, changes = []) => ({ id, title, summary, changes });
const entrances = () => [1, 6].flatMap(y => [1, 6, 11, 16].map(x => ({ x, y })));
const map = (id, title, difficult = []) => ({ id, title, width: 32, height: 24, blocked: [], difficult });

const requests = {
  accord: {
    title: 'The Lantern Accord', mapId: 'bellweather-ferry-house',
    briefing: 'Nera Venn asks the Lantern Compact to help Bellweather Weir resolve a debt before its creditor withholds the festival lamp allotment at sunset on Day 8. Seek a workable settlement that residents accept and establish why the contract names an unrecognized resident as guarantor. The debt paid for real repairs; the disputed recognition clause is a separate question. A ferry-house assembly, the creditor, an old boat permit and a festival rehearsal offer different ways forward. The residents retain their own consent.',
    summary: 'Help Bellweather reach an accepted settlement; distinguish the legitimate repair bill from the disputed recognition clause.',
    cost: 'Bellweather is roughly one travel day east by boat. Sunset on Day 8 is the stated deadline. Money, testimony and community consent depend on the approach actually chosen.',
    trackIds: ['riverfolk'], priorities: council(3, 2, 3, 2, 3),
    outcomes: [
      outcome('revised-agreement', 'A revised agreement', 'Bellweather accepted a revised agreement. Its legitimate repair debt was considered separately from the recognition clause.'),
      outcome('shared-repayment', 'Shared repayment and independent maintenance', 'Bellweather accepted shared repayment with independent maintenance. The agreement depends on the contributions and consent actually established in play.'),
      outcome('clause-challenged', 'The recognition clause was challenged', 'Independent records supported a challenge to the recognition clause. This finding did not erase the legitimate repair bill or decide any resident\'s wishes.'),
      outcome('community-settlement', 'The community proposed its settlement', 'Bellweather proposed and accepted its own settlement. The Compact did not substitute its authority for the residents\' consent.'),
      outcome('unresolved', 'The request remains unresolved', 'No accepted settlement was established. Bellweather\'s request remains open; no deadline or offscreen consequence has been advanced by this resolution.'),
    ],
  },
  archive: {
    title: 'The Quiet Archive', mapId: 'sunken-archive-reading-room',
    briefing: 'Oren Vale asks the Lantern Compact to recover a missing civic record before a Day 9 hearing condemns his mentor for falsifying provisioning accounts. Establish what the record says and who had access to it. The lower reading room, a clerk, independent records and a bronze witness bell provide different lines of inquiry. Recovering evidence does not decide its interpretation, the hearing\'s finding or what should be shared publicly. Suitable spells remain useful.',
    summary: 'Establish the missing record\'s contents and access history before Oren\'s mentor\'s hearing.',
    cost: 'The hearing is on Day 9. Recovery, corroboration, a witness interview or an adjournment carry different obligations; protect the people who provide evidence.',
    trackIds: ['archive-confidence', 'oren'], priorities: council(2, 3, 2, 3, 2),
    outcomes: [
      outcome('original-recovered', 'The original was recovered', 'The party recovered the original record. Possession of it does not itself establish a hearing verdict or authorize public disclosure.'),
      outcome('copy-corroborated', 'The copy was corroborated', 'Oren\'s copy was supported by independent records. The hearing\'s finding and who receives copies remain separate decisions.'),
      outcome('scribe-account', 'The scribe gave an account', 'The party obtained the scribe\'s account. Its exact contents, corroboration and permitted recipients are the testimony actually established in play.'),
      outcome('adjournment', 'An adjournment was secured', 'An adjournment was secured while witnesses were protected. The missing record and allegations remain questions to resolve.'),
      outcome('unresolved', 'The request remains unresolved', 'The record inquiry remains unresolved. No loss of office, Ministry appointment or deadline advancement has been inferred.'),
    ],
  },
  vigil: {
    title: 'The Ember Vigil', mapId: 'ember-crossing-beacon',
    briefing: 'Ember Crossing asks for relief before its public emergency assembly on the morning of Day 8. Explain the alarms and help residents make an informed safety decision. A tired watchkeeper, a partly recognized returning traveler and old distress calls in the beacon chamber offer different leads. Establish what each alarm means before deciding how to respond. Erased people retain their identity and agency; they must not be treated as monsters. Any immediate threat and the town\'s civic decision remain separate questions.',
    summary: 'Investigate the repeated alarms and protect Ember Crossing while the town decides what safety requires.',
    cost: 'Ember Crossing is roughly one travel day upriver. Its emergency assembly is on the morning of Day 8. Repairs, protection and temporary relocation need separate decisions.',
    trackIds: ['crossing-readiness'], priorities: council(3, 2, 3, 3, 3),
    outcomes: [
      outcome('signals-investigated', 'The repeating signals were investigated', 'The party investigated the repeating distress signals. Identifying old echoes did not prove that every alarm was false or repair the breach.'),
      outcome('people-protected', 'People were protected during examination', 'People were protected while a specialist examined the ward. The examination\'s findings and any repair are the facts established in play.'),
      outcome('temporary-relocation', 'Residents chose temporary relocation', 'The participating residents chose temporary relocation while the beacon could be examined or repaired. Others were not presumed to agree.'),
      outcome('hollow-located', 'A Hollow was located', 'A predatory Hollow was located at the failed warning. Its discovery did not determine that the party must fight it or decide the residents\' response.'),
      outcome('unresolved', 'The request remains unresolved', 'The alarm inquiry remains open. No assembly decision, Ministry agreement or automatic hostility has been inferred.'),
    ],
  },
};

function adjudicated(id, title, mapId, briefing, outcomes) {
  return { id, title, briefing, mapId, resolution: 'adjudicated', outcomes: structuredClone(outcomes) };
}
function node(mission, next, details = {}) {
  return { mission, summary: details.summary ?? mission.briefing, cost: details.cost ?? 'Only the costs actually agreed and incurred in play apply.', trackIds: details.trackIds ?? [], priorities: details.priorities ?? council(1, 1, 1, 1, 1), next };
}
function hollow() {
  return {
    id: 'ember-warning-hollow', name: 'Hollow at the failed warning', owner: null, team: 'hollow', x: 24, y: 17, size: 1,
    hp: 12, maxHp: 12, ac: 12, speed: 30, vision: 8, initiative: 5, characterVersion: 'proposed-hollow-v1',
    weapon: { name: 'Echo grasp', abilityScore: 12, proficiencyBonus: 2, proficient: true, equipmentBonus: 0, damageDice: 1, damageDie: 6, addAbilityToDamage: true, rangeFeet: 5 },
  };
}

/** Produce fresh authoring data. This function neither approves nor installs it. */
export function createGreyharborProposal() {
  const pack = {
    schemaVersion: 1, id: 'greyharbor-opening-proposal-v1', title: 'The Lanterns of Greyharbor — opening requests',
    world: { id: 'avarra', title: 'Avarra' },
    regions: [{ id: 'lantern-reach', title: 'The Lantern Reach' }],
    locations: [
      { id: 'last-hearth', title: 'The Last Hearth, Greyharbor', regionId: 'lantern-reach' },
      { id: 'bellweather', title: 'Bellweather Weir', regionId: 'lantern-reach' },
      { id: 'archive', title: 'The Sunken Archive, Greyharbor', regionId: 'lantern-reach' },
      { id: 'crossing', title: 'Ember Crossing', regionId: 'lantern-reach' },
    ],
    scenes: [
      { map: map('last-hearth-map-room', 'The Last Hearth — map room'), locationId: 'last-hearth', entrances: entrances(), npcs: [], effects: [] },
      { map: map('bellweather-ferry-house', 'Bellweather Weir — ferry house'), locationId: 'bellweather', entrances: entrances(), npcs: [], effects: [] },
      { map: map('sunken-archive-reading-room', 'The Sunken Archive — lower reading room', [{ x: 22, y: 15 }, { x: 23, y: 15 }]), locationId: 'archive', entrances: entrances(), npcs: [], effects: [] },
      { map: map('ember-crossing-beacon', 'Ember Crossing — beacon chamber'), locationId: 'crossing', entrances: entrances(), npcs: [], effects: [] },
      { map: map('ember-failed-warning', 'Ember Crossing — the failed warning'), locationId: 'crossing', entrances: entrances(), npcs: [hollow()], effects: [] },
    ],
    missions: [],
  };
  const opening = adjudicated('greyharbor-arrival', 'The unlit lantern', 'last-hearth-map-room',
    'Day 6. Rain ticks against the Last Hearth\'s map-room windows; the River Vey carries reflections toward the sea. Lysa brings a crooked paper bird that will not take a flame. She cannot remember who gave it to her, but the heroes remember yesterday\'s ferryman, his muddy boots and his joke. Three requests lie beside it: Bellweather\'s debt, Oren\'s missing record and Ember Crossing\'s alarms. Raphael speaks in the way each hero recognizes: “Begin with the person, chosen ones. The light remembers why it was lit.” Ask what the heroes remember and what they do. They may examine the lantern, talk to Lysa, follow the ferryman, open any request or propose another response.',
    [outcome('briefing-shared', 'The opening was shared', 'The heroes encountered the unlit lantern and the three Day 6 requests. No identity, culprit, mission order or future outcome was decided for them.')]);
  pack.missions.push(node(opening, ['accord-first', 'archive-first', 'vigil-first'], { cost: 'The opening begins on Day 6. Reading the requests does not advance fictional time.' }));
  const finish = ['return-last-hearth', 'review-further-requests'];
  const seenStates = new Set();
  function addRequests(done) {
    for (const key of Object.keys(requests).filter(k => !done.includes(k))) {
      const stateKey = [...done].sort().join('-') || 'first';
      const id = `${key}-${stateKey}`;
      if (seenStates.has(id)) continue;
      seenStates.add(id);
      const after = [...done, key].sort();
      const remaining = Object.keys(requests).filter(k => !after.includes(k));
      const forward = remaining.map(k => `${k}-${after.join('-')}`);
      const next = forward.length ? [...forward, finish[0]] : [...finish];
      const request = requests[key];
      const title = request.title;
      const mission = adjudicated(id, title, request.mapId, request.briefing, request.outcomes);
      if (key === 'vigil') {
        const combatId = `hollow-${stateKey}`, civicId = `vigil-civic-${stateKey}`;
        const requestNode = node(mission, [combatId, ...next], request);
        requestNode.nextByOutcome = Object.fromEntries(mission.outcomes.map(result => [result.id, result.id === 'hollow-located' ? [combatId, ...next] : [...next]]));
        pack.missions.push(requestNode);
        pack.missions.push(node({
          id: combatId, title: 'The Ember Vigil — Hollow at the warning', mapId: 'ember-failed-warning', successTeam: 'party',
          briefing: 'A predatory Hollow has formed where the ward repeats a failed warning. This encounter is for a party that chose to confront this immediate threat. The Hollow is not an erased resident. Removing it does not repair the beacon, decide a relocation, establish anyone\'s guilt or settle the civic dispute.',
          success: { summary: 'The immediate Hollow threat was defeated. The beacon\'s condition and the community\'s safety decision remain separate questions.', changes: [{ trackId: 'crossing-readiness', delta: 3 }] },
          failure: { summary: 'The confrontation ended without the party controlling the immediate threat. No resident\'s fate, relocation decision or campaign ending has been invented.', changes: [{ trackId: 'crossing-readiness', delta: -3 }] },
        }, [civicId, finish[0]], { ...request, summary: 'Confront the located Hollow; this is an optional combat approach.', cost: 'Confronting the Hollow may cause injury and spend combat resources. The town\'s safety decision remains separate.' }));
        pack.missions.push(node(adjudicated(civicId, 'The Ember Vigil — the town decides', request.mapId,
          'Return to Ember Crossing\'s residents after the confrontation. Discuss what the party actually learned and whether people want protection, repairs or temporary relocation. The surviving watchkeepers and residents retain their own voice. A defeated Hollow is not proof that the ward is repaired.',
          [outcome('informed-decision', 'The residents made an informed decision', 'The residents reached the safety decision established in play, using the evidence they actually received. The beacon was not automatically repaired.'), outcome('decision-pending', 'The decision remains open', 'The community\'s safety decision remains open. Protection, testimony and repair can continue without a predetermined settlement.')]), next, request));
      } else pack.missions.push(node(mission, next, request));
      addRequests(after);
    }
  }
  addRequests([]);
  pack.missions.push(node(adjudicated(finish[0], 'Return to the Last Hearth', 'last-hearth-map-room',
    'Return to the former riverside signal house: common room, kitchen, infirmary, workshop and map table. Share the promises kept, people met and questions still open. Brother Halden offers a home between missions. Returning does not heal injuries or spend a day by itself. Unfinished requests remain part of the world.',
    [outcome('homecoming-recorded', 'A homecoming was recorded', 'The party returned to the Last Hearth carrying its actual injuries, promises and discoveries. No rest, healing, deadline or unfinished request was resolved automatically.')]), []));
  pack.missions.push(node(adjudicated(finish[1], 'The Last Hearth — further requests', 'last-hearth-map-room',
    'At the Last Hearth, review what remains unfinished and what the party wants to do next. Bellweather, the Archive and Ember Crossing keep their actual outcomes. The Festival of Returning Lights may become a consequential public choice when the party has evidence and chooses to respond; this pack does not force that climax. Choose the next journey from the facts and concerns the party actually carries home.',
    [outcome('next-concerns-recorded', 'The next concerns were recorded', 'The heroes discussed their next concerns. No unchosen future scene or council recommendation was turned into a completed fact.')]), []));
  return {
    review: {
      status: 'proposed-host-review-required',
      sources: ['WORLD_STORY_FRAMEWORK.md#10-the-opening-missions', 'WORLD_STORY_FRAMEWORK.md#15-opening-scene-the-unlit-lantern', 'WORLD_STORY_FRAMEWORK.md#6-places-that-remember', 'WORLD_STORY_FRAMEWORK.md#12-a-world-that-advances-between-sessions'],
      mechanics: ['All grid dimensions, terrain cells, party entrances, NPC statistics, council ratings and numeric combat deltas are proposals, not source facts.', 'Narrative scenes require explicit host-adjudicated resolution; ending a turn or defeating a team must not resolve them.', 'Choose an outcome only after it happened in play. Record exact contributions, consent, testimony recipients and local decisions in the session record before confirming.', 'Five-foot tactical cells are local scene geometry, not a geographic map. The eight entrances reserve non-overlapping 4-by-4 footprints for size-one to size-four party actors.', 'The mission DAG models one pass through the three requests in any order, with optional homecoming after each request. It does not erase unresolved requests or automate their deadlines.', 'The optional Hollow encounter is the only combat encounter; it does not decide politics or repair the beacon.', 'No source art is automatically approved, attached or reused: this pack format has no per-view image binding.'],
      remaining: ['Fictional day progression and the four 0-to-6 clocks', 'Exact settlement costs, ownership of evidence, individual testimony and NPC knowledge records', 'Split-party simultaneous requests and open-ended player-created approaches', 'Further visits after the terminal homecoming; later campaign movements and Nareth', 'Host approval of mechanics, party fit, and per-view art'],
    },
    openingMissionId: opening.id,
    tracks: [
      { id: 'readiness', kind: 'readiness', label: 'Compact readiness', value: 72 }, { id: 'attention', kind: 'attention', label: 'Public attention', value: 38 },
      { id: 'hearth', kind: 'faction', label: 'Hearthbound trust', value: 62 }, { id: 'nightglass', kind: 'faction', label: 'Nightglass influence', value: 37 }, { id: 'riverfolk', kind: 'faction', label: 'Riverfolk trust', value: 68 },
      { id: 'greyharbor-stability', kind: 'location', label: 'Greyharbor stability', value: 64 }, { id: 'archive-confidence', kind: 'location', label: 'Archive confidence', value: 47 }, { id: 'crossing-readiness', kind: 'location', label: 'Crossing readiness', value: 71 },
      { id: 'lysa', kind: 'relationship', label: 'Lysa trust', value: 58 }, { id: 'oren', kind: 'relationship', label: 'Oren trust', value: 51 }, { id: 'sable', kind: 'relationship', label: 'Sable trust', value: 34 },
    ],
    pack,
  };
}
