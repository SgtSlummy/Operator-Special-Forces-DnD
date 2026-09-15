export const VERSION = 1;
export const ASSET_ROOT = '/art/';
const beaconLayers = [
  ['b0', 'Foundation', 0, 'beacon-00', .802, .14, 'Control desks, pipe inlets and the southern entrance.'],
  ['b1', 'Maintenance ring', 100, 'beacon-100', .457, .135, 'Pipe manifolds, a hoist and a broad circular walkway.'],
  ['b2', 'Signal gallery', 200, 'beacon-200', .253, .105, 'Calibration tables, blue glass instruments and the astronomical dial.'],
  ['b3', 'Crown observatory', 275, 'beacon-275', .083, .085, 'The lens cradle and upper gear trains, beneath the 300-foot ceiling.']
].map(([id, name, feet, image, cy, depth, note]) => ({id, name, feet, image: ASSET_ROOT + 'v2-layers/' + image + '.png', note, slice: [1, 0, 1, 0], overview: [.73, .135, depth, cy - depth / 2], entry: [.13, .48]}));
export const AREAS = {
  beacon: {id: 'beacon', name: 'Beacon Heart', subtitle: 'A machine the size of a tower', envelope: '180 ft diameter · 300 ft high', disclosure: 'On discovery · GM preview', overview: ASSET_ROOT + 'v1/on-discovery/07-beacon-heart-cutaway.png', layers: beaconLayers, note: 'The tower envelope comes from the dungeon atlas. These four floor elevations and interiors are proposed architecture. The overview projects positions onto each ring; it is an approximate registration of painted art.'},
  ferry: {id: 'ferry', name: 'Brinewatch ferry', subtitle: 'The ferry with no shore', envelope: 'Quay, passenger deck and lower hold', disclosure: 'Opening area · interiors on discovery', overview: ASSET_ROOT + 'v2-layers/ferry-overview.png', layers: [
    {id: 'f0', name: 'Quay & passenger deck', feet: 0, image: ASSET_ROOT + 'v2-layers/ferry-main.png', note: 'Harbor office, quay, gangplank, passenger benches and the wheelhouse.', slice: [1,0,1,0], entry: [.665,.738]},
    {id: 'f1', name: 'Lower hold', feet: -8, image: ASSET_ROOT + 'v2-layers/ferry-hold.png', note: 'Timber ribs, cargo bays, six bunks and a stair to the wheelhouse.', slice: [.94/.72, .03-.18*.94/.72, .42/.31, .29-.56*.42/.31], entry: [.70,.71]}
  ], note: 'The lower hold, stairs and 8-foot deck separation are proposed additions. Ferry artwork is illustrative and has no authoritative distance scale. Inspect furniture, walls and doors before agreeing movement.'}
};
export const COLORS = ['#b74930', '#156b82', '#7b4594', '#416627', '#a76318', '#7d3756'];
export function initialState() {
  return {version: VERSION, area: 'beacon', layer: 'b0', selected: 'p1', mode: 'preview', grid: false, players: [
    {id:'p1', name:'Preview A', color:COLORS[0], area:'beacon', layer:'b0', u:.35, v:.76},
    {id:'p2', name:'Preview B', color:COLORS[1], area:'beacon', layer:'b0', u:.53, v:.83},
    {id:'p3', name:'Preview C', color:COLORS[2], area:'beacon', layer:'b1', u:.20, v:.47},
    {id:'p4', name:'Preview D', color:COLORS[3], area:'ferry', layer:'f0', u:.51, v:.70}
  ]};
}
export function layerFor(area, layer) { return AREAS[area]?.layers.find(item => item.id === layer); }
export function affine(u, v, values) { return {x: u * values[0] + values[1], y: v * values[2] + values[3]}; }
export function slicePosition(player) { return affine(player.u, player.v, layerFor(player.area, player.layer).slice); }
export function fromSlice(area, layer, x, y) {
  const [sx,ox,sy,oy] = layerFor(area,layer).slice;
  return {u:(x-ox)/sx, v:(y-oy)/sy};
}
export function overviewPosition(player) {
  const layer = layerFor(player.area, player.layer);
  if (player.area === 'beacon') return affine(player.u, player.v, layer.overview);
  if (player.layer === 'f1') return {x:.085+(player.u-.18)/.72*.83, y:.66+(player.v-.56)/.31*.15};
  if (player.v <= .42) return {x:player.u, y:player.v*.77};
  if (player.v < .56) return {x:.502, y:.32+(player.v-.42)/.14*.13};
  return {x:.085+(player.u-.18)/.72*.83, y:.435+(player.v-.56)/.31*.23};
}
export function inFootprint(area, layer, u, v) {
  if (![u,v].every(Number.isFinite)) return false;
  if (area === 'beacon') {
    const r = Math.hypot(u-.5,v-.48);
    if (r > .445 || r < .10) return false;
    return layer === 'b0' || r >= .265 || Math.abs(v-.48) < .035;
  }
  if (area !== 'ferry') return false;
  const ship = ((u-.54)/.37)**2 + ((v-.72)/.148)**2 <= 1;
  return layer === 'f1' ? ship : ship || (u>.035 && u<.965 && v>.02 && v<.42) || (u>.482 && u<.525 && v>=.42 && v<=.59);
}
export function movePlayer(state, playerId, area, layer, u, v) {
  if (!layerFor(area,layer) || !inFootprint(area,layer,u,v)) throw new Error('Choose a position inside the mapped floor. Walls and furniture still need a GM ruling.');
  const player=state.players.find(p=>p.id===playerId);
  if (!player) throw new Error('Select a party marker first.');
  Object.assign(player,{area,layer,u,v});
  return player;
}
export function changeView(state, area, layer) {
  if (!layerFor(area,layer)) throw new Error('Unknown map layer.');
  state.area=area; state.layer=layer;
}
export function transferPlayer(state, playerId, direction) {
  const player=state.players.find(p=>p.id===playerId);
  if (!player) throw new Error('Select a party marker first.');
  const layers=AREAS[player.area].layers;
  const index=layers.findIndex(layer=>layer.id===player.layer);
  const sorted=[...layers].sort((a,b)=>a.feet-b.feet);
  const next=sorted[sorted.findIndex(layer=>layer.id===layers[index].id)+direction];
  if (!next) throw new Error('There is no mapped floor in that direction.');
  movePlayer(state,playerId,player.area,next.id,...next.entry);
  changeView(state,player.area,next.id);
  return player;
}
export function validateState(input) {
  if (!input || input.version!==VERSION || !['preview','manual'].includes(input.mode) || typeof input.grid!=='boolean' || !layerFor(input.area,input.layer) || !Array.isArray(input.players) || input.players.length<1 || input.players.length>8) throw new Error('This file is not a supported map-table save.');
  const ids=new Set();
  const players=input.players.map(p=>{
    if (!p || typeof p.id!=='string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(p.id) || ids.has(p.id) || typeof p.name!=='string' || !p.name.trim() || p.name.length>32 || !COLORS.includes(p.color) || !layerFor(p.area,p.layer) || !inFootprint(p.area,p.layer,p.u,p.v)) throw new Error('A party marker has invalid details or coordinates.');
    ids.add(p.id);
    return {id:p.id,name:p.name.trim(),color:p.color,area:p.area,layer:p.layer,u:p.u,v:p.v};
  });
  if (!ids.has(input.selected)) throw new Error('The selected party marker is missing.');
  return {version:VERSION,area:input.area,layer:input.layer,selected:input.selected,mode:input.mode,grid:input.grid,players};
}
