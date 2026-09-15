import { createHmac, timingSafeEqual } from 'node:crypto';

export const RPG_CORE_BRIDGE_CONTRACT = 'rpg-core-runtime-bridge-v1';
export const RPG_CORE_COMMAND_PATH = '/api/rpg/command';
export const RPG_CORE_PROJECTION_PATH = '/api/rpg/projection';
const MAX_CLOCK_SKEW_MS = 30000;

export class RuntimeBridgeError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'RuntimeBridgeError';
    this.code = code;
    this.status = status;
  }
}

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new RuntimeBridgeError('INVALID_BRIDGE_INPUT', `${label} is required.`, 400);
  return value.trim();
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RuntimeBridgeError('INVALID_BRIDGE_INPUT', `${label} must be a non-negative integer.`, 400);
  return value;
}

function secretFrom(env) {
  const secret = env?.RAPHAEL_GAME_BRIDGE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new RuntimeBridgeError('BRIDGE_SECRET_MISSING', 'Configure a dedicated RPG-Core bridge secret.', 500);
  }
  if (secret === env?.DISCORD_TOKEN) {
    throw new RuntimeBridgeError('BRIDGE_SECRET_REUSED', 'The RPG-Core bridge secret must not be the Discord token.', 500);
  }
  return secret;
}

function canonical(value) {
  return JSON.stringify(value);
}

export function signBridgeBody(body, secret, timestamp) {
  return createHmac('sha256', required(secret, 'bridge secret')).update(`${timestamp}.${canonical(body)}`).digest('hex');
}

export function verifyBridgeSignature(body, secret, timestamp, signature, now = Date.now()) {
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS || !/^[a-f0-9]{64}$/.test(signature ?? '')) return false;
  const expected = signBridgeBody(body, secret, timestamp);
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

function safeCharacter(character, audience) {
  if (!character || typeof character !== 'object') return null;
  const projected = {
    characterId: required(character.characterId, 'character id'),
    displayName: String(character.displayName ?? ''),
    characterType: String(character.characterType ?? ''),
    raceId: String(character.raceId ?? ''),
    classId: String(character.classId ?? ''),
    factionId: String(character.factionId ?? ''),
    primaryHealth: integer(character.primaryHealth ?? 0, 'primary health'),
    primaryHealthMaximum: integer(character.primaryHealthMaximum ?? 0, 'primary health maximum'),
    secondaryHealth: integer(character.secondaryHealth ?? 0, 'secondary health'),
    secondaryHealthMaximum: integer(character.secondaryHealthMaximum ?? 0, 'secondary health maximum'),
    position: { x: integer(character.position?.x ?? 0, 'position x'), y: integer(character.position?.y ?? 0, 'position y') },
    defeated: Boolean(character.defeated),
  };
  if (audience === 'private') {
    projected.ownerId = String(character.ownerId ?? '');
    projected.genderId = String(character.genderId ?? '');
    projected.passiveAbilityIds = [...new Set(Array.isArray(character.passiveAbilityIds) ? character.passiveAbilityIds.map(String) : [])];
    projected.skillRanks = Object.fromEntries(Object.entries(character.skillRanks ?? {}).map(([id, rank]) => [String(id), integer(rank, 'skill rank')]));
    projected.actionBarBindings = Object.fromEntries(Object.entries(character.actionBarBindings ?? {}).map(([slot, id]) => [slot, String(id)]));
    projected.activeEffectIds = [...new Set(Array.isArray(character.activeEffectIds) ? character.activeEffectIds.map(String) : [])];
    projected.equipmentBonuses = Object.fromEntries(Object.entries(character.equipmentBonuses ?? {}).map(([id, value]) => [String(id), integer(value, 'equipment bonus')]));
    projected.currency = integer(character.currency ?? 0, 'currency');
  }
  return projected;
}

export function filterRuntimeProjection(input, audience = 'public') {
  if (!input || typeof input !== 'object' || !['public', 'private'].includes(audience)) throw new RuntimeBridgeError('INVALID_PROJECTION', 'The runtime projection is invalid.', 502);
  const projection = {
    contract: RPG_CORE_BRIDGE_CONTRACT,
    campaignId: required(input.campaignId, 'campaign id'),
    revision: integer(input.revision, 'revision'),
    currentSceneId: String(input.currentSceneId ?? ''),
    phase: String(input.phase ?? ''),
    round: integer(input.round ?? 0, 'round'),
    activeActorId: String(input.activeActorId ?? ''),
    characters: Array.isArray(input.characters) ? input.characters.map(character => safeCharacter(character, audience)).filter(Boolean) : [],
    map: input.map && typeof input.map === 'object' ? {
      id: String(input.map.id ?? ''),
      width: integer(input.map.width ?? 0, 'map width'),
      height: integer(input.map.height ?? 0, 'map height'),
      cells: Array.isArray(input.map.cells) ? input.map.cells.map(cell => ({ x: integer(cell.x ?? 0, 'cell x'), y: integer(cell.y ?? 0, 'cell y'), terrain: String(cell.terrain ?? '') })) : [],
    } : null,
  };
  if (audience === 'private') {
    projection.inventory = input.inventory && typeof input.inventory === 'object' ? structuredClone(input.inventory) : { items: [], currency: 0 };
  }
  return projection;
}

function validateResponse(value, campaignId, commandId = null) {
  if (!value || typeof value !== 'object' || value.contract !== RPG_CORE_BRIDGE_CONTRACT || value.campaignId !== campaignId || (commandId && value.commandId !== commandId)) {
    throw new RuntimeBridgeError('INVALID_BRIDGE_RESPONSE', 'The RPG-Core bridge returned an invalid response.');
  }
  integer(value.revision, 'revision');
  return value;
}

export function createRuntimeBridge({ baseUrl, campaignId, channelId, env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const origin = required(baseUrl, 'bridge base URL').replace(/\/$/, '');
  const campaign = required(campaignId, 'campaign id');
  const channel = required(channelId, 'channel id');
  const secret = secretFrom(env);
  if (typeof fetchImpl !== 'function') throw new RuntimeBridgeError('BRIDGE_UNAVAILABLE', 'A bridge transport is not configured.', 500);

  async function request(path, body, commandId = null) {
    const timestamp = now();
    const signature = signBridgeBody(body, secret, timestamp);
    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rpg-core-contract': RPG_CORE_BRIDGE_CONTRACT, 'x-rpg-core-timestamp': String(timestamp), 'x-rpg-core-signature': signature },
        body: canonical(body),
      });
    } catch {
      throw new RuntimeBridgeError('BRIDGE_UNAVAILABLE', 'The RPG-Core runtime is unavailable.');
    }
    let value;
    try { value = await response.json(); } catch { throw new RuntimeBridgeError('INVALID_BRIDGE_RESPONSE', 'The RPG-Core bridge returned invalid JSON.'); }
    if (!response.ok) throw new RuntimeBridgeError(value?.code ?? 'RUNTIME_REJECTED', String(value?.message ?? 'The runtime rejected the command.'), response.status);
    return validateResponse(value, campaign, commandId);
  }

  return Object.freeze({
    async command({ commandId, ownerId, actorId = '', expectedRevision, type, payload = {} } = {}) {
      const id = required(commandId, 'command id');
      const owner = required(ownerId, 'owner id');
      const actor = actorId ? required(actorId, 'actor id') : '';
      const revision = integer(expectedRevision, 'expected revision');
      const action = required(type, 'command type');
      return request(RPG_CORE_COMMAND_PATH, { contract: RPG_CORE_BRIDGE_CONTRACT, campaignId: campaign, channelId: channel, commandId: id, ownerId: owner, actorId: actor, expectedRevision: revision, type: action, payload }, id);
    },
    async projection({ ownerId, audience = 'public' } = {}) {
      const owner = required(ownerId, 'owner id');
      const response = await request(RPG_CORE_PROJECTION_PATH, { contract: RPG_CORE_BRIDGE_CONTRACT, campaignId: campaign, channelId: channel, ownerId: owner, audience }, null);
      return filterRuntimeProjection(response.projection, audience);
    },
  });
}

export function createRuntimeBridgeFromEnv({ campaignId, channelId, env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  return createRuntimeBridge({ baseUrl: env?.RPG_CORE_BRIDGE_URL, campaignId, channelId, env, fetchImpl, now });
}
