import { createHash } from 'node:crypto';

export const UPLOAD_CONTRACT = 'raph-obus-game-evidence-upload-v1';
export const UPLOAD_ROOT = '/api/game/evidence/upload';
export const DOCUMENT_LIMIT = 64 * 1024 * 1024;
export const DOCUMENT_SOURCES = 65536;
export const UPLOAD_LIMIT = 256 * 1024;
export const PAGE_LIMIT = 240 * 1024;
export const PAGE_SOURCES = 256;
const MAX_PAGES = 512;

function invalid() { throw Object.assign(new Error('Invalid Obus evidence upload.'), { name: 'ObusHostControlError', code: 'INVALID_OBUS_EVIDENCE_UPLOAD', status: 400 }); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
// Python's canonical JSON sorts strings by Unicode code point, not UTF-16 unit.
function compare(left, right) {
  const a = Array.from(left, value => value.codePointAt(0)), b = Array.from(right, value => value.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
export function canonicalEvidence(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(',')}]`;
  return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${canonicalEvidence(value[key])}`).join(',')}}`;
}
function bytes(value) { return Buffer.byteLength(canonicalEvidence(value), 'utf8'); }
function digest(value) { return createHash('sha256').update(canonicalEvidence(value), 'utf8').digest('hex'); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Input must first pass prepareEvidenceDocument's bounded immutable schema check. */
export function planEvidenceUpload(document) {
  const { runtime, ...body } = document;
  body.participants = [...document.participants].sort((a, b) => compare(a.user, b.user));
  body.sources = document.sources.map(source => ({ ...source,
    contributors: [...source.contributors].sort((a, b) => compare(a.user, b.user)),
    derivesFrom: [...source.derivesFrom].sort((a, b) => compare(a.ref, b.ref)),
  })).sort((a, b) => compare(a.ref, b.ref));
  const documentBytes = bytes(body);
  if (documentBytes > DOCUMENT_LIMIT || body.sources.length > DOCUMENT_SOURCES) invalid();
  const groups = [];
  let group = [], size = 2;
  for (const source of body.sources) {
    const sourceBytes = bytes(source);
    if (sourceBytes + 2 > PAGE_LIMIT) invalid();
    if (group.length === PAGE_SOURCES || size + sourceBytes + (group.length ? 1 : 0) > PAGE_LIMIT) {
      groups.push(group); group = []; size = 2;
    }
    size += sourceBytes + (group.length ? 1 : 0); group.push(source);
  }
  if (group.length || !groups.length) groups.push(group);
  if (groups.length > MAX_PAGES) invalid();
  const manifest = { contract: UPLOAD_CONTRACT, operation: 'begin', campaign: body.campaign, session: body.session,
    revision: body.revision, documentHash: digest(body), documentBytes, sourceCount: body.sources.length,
    participants: body.participants, pages: groups.map(sources => ({ sha256: digest(sources), bytes: bytes(sources), count: sources.length })) };
  const uploadId = digest(manifest);
  const common = { contract: UPLOAD_CONTRACT, campaign: body.campaign, session: body.session, runtime, uploadId };
  const begin = { ...manifest, runtime, uploadId };
  const pages = groups.map((sources, index) => ({ ...common, operation: 'page', index, sources }));
  const commit = { ...common, operation: 'commit' };
  for (const command of [begin, ...pages, commit]) if (bytes(command) > UPLOAD_LIMIT) invalid();
  return freeze({ begin, pages, commit });
}

/** Validate persistence acknowledgments, never authorization or model output. */
export function validateUploadStatus(value, plan) {
  const required = ['contract', 'campaign', 'session', 'uploadId', 'revision', 'status', 'pageCount', 'sourceCount', 'participantCount', 'received'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const allowed = value.status === 'complete' ? [...required, 'receipt'] : required;
  if (Object.keys(value).length !== allowed.length || allowed.some(key => !Object.hasOwn(value, key))) invalid();
  const expected = plan.begin;
  if (value.contract !== UPLOAD_CONTRACT || value.campaign !== expected.campaign || value.session !== expected.session || value.uploadId !== expected.uploadId || value.revision !== expected.revision || value.pageCount !== plan.pages.length || value.sourceCount !== expected.sourceCount || value.participantCount !== expected.participants.length || !['pending', 'deferred', 'complete'].includes(value.status)) invalid();
  if (!Array.isArray(value.received) || value.received.length > plan.pages.length || value.received.some((index, i) => !integer(index) || index >= plan.pages.length || (i > 0 && index <= value.received[i - 1]))) invalid();
  if (value.status !== 'pending' && value.received.length) invalid();
  return freeze(value);
}
