import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

const CAMPAIGN = /^[a-zA-Z0-9_-]{1,64}$/;
const OWNER = /^\d{17,20}$/;
const MAX_BODY = 1024;
const REQUEST_TIMEOUT = 5000;
const invalid = () => new TypeError('Invalid membership bridge configuration.');
const digest = value => createHash('sha256').update(value).digest();

function configuration({ game, token, campaigns } = {}) {
  if (!game || typeof game.member !== 'function' || typeof token !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(token) ||
      !Array.isArray(campaigns) || campaigns.length < 1 || campaigns.length > 100 ||
      campaigns.some(campaign => typeof campaign !== 'string' || !CAMPAIGN.test(campaign))) throw invalid();
  return { game, authorization: digest(`Bearer ${token}`), campaigns: new Set(campaigns) };
}

function respond(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close',
  });
  response.end(bytes);
}

function authenticated(request, server, expected) {
  const remote = request.socket.remoteAddress, address = server.address();
  const authorization = typeof request.headers.authorization === 'string' ? request.headers.authorization : '';
  // Comparing fixed-size digests keeps verification constant-time even when
  // an invalid presented credential has a different length.
  const credentialMatches = timingSafeEqual(digest(authorization), expected);
  let hosts = 0, credentials = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (name === 'host') hosts++;
    if (name === 'authorization') credentials++;
  }
  const proxy = Object.keys(request.headers).some(name => name === 'origin' || name === 'forwarded' || name === 'via' ||
    name === 'x-real-ip' || name === 'x-forwarded' || name.startsWith('x-forwarded-'));
  return credentialMatches && request.rawHeaders.length <= 64 && hosts === 1 && credentials === 1 && !proxy &&
    (remote === '127.0.0.1' || remote === '::ffff:127.0.0.1') &&
    address && typeof address === 'object' && request.headers.host === `127.0.0.1:${address.port}`;
}

function body(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      request.off('data', data); request.off('end', end); request.off('aborted', aborted); request.off('error', aborted);
      if (error) { request.pause(); reject(new Error('Invalid request.')); } else resolve(value);
    };
    const data = chunk => {
      length += chunk.length;
      if (length > MAX_BODY) { finish(true); return; }
      chunks.push(chunk);
    };
    const end = () => {
      try { finish(false, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(true); }
    };
    const aborted = () => finish(true);
    const timer = setTimeout(aborted, REQUEST_TIMEOUT); timer.unref();
    request.on('data', data); request.once('end', end); request.once('aborted', aborted); request.once('error', aborted);
  });
}

/** Creates an unbound server. The caller owns GameStore and its lifecycle. */
export function createMembershipBridge(options) {
  const { game, authorization, campaigns } = configuration(options);
  const server = createServer({ maxHeaderSize: 4096, headersTimeout: 3000, requestTimeout: REQUEST_TIMEOUT,
    keepAliveTimeout: 1000, connectionsCheckingInterval: 1000 }, (request, response) => {
    request.on('error', () => {});
    void (async () => {
      if (!authenticated(request, server, authorization)) { respond(response, 401, { error: 'Unauthorized.' }); return; }
      const contentLength = request.headers['content-length'];
      if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY)) {
        respond(response, 400, { error: 'Invalid request.' }); return;
      }
      if (request.method === 'GET' && request.url === '/v1/status') {
        if (Number(contentLength || 0) !== 0 || request.headers['transfer-encoding'] !== undefined) {
          respond(response, 400, { error: 'Invalid request.' }); return;
        }
        respond(response, 200, { ready: true, service: 'operator-membership', version: 1 }); return;
      }
      if (request.method !== 'POST' || !['/v1/authorize-command', '/v1/authorize-participant'].includes(request.url) ||
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '') ||
          request.headers['content-encoding'] !== undefined) {
        respond(response, 400, { error: 'Invalid request.' }); return;
      }
      const input = await body(request);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 ||
          Object.keys(input).some(key => key !== 'campaign' && key !== 'owner') ||
          typeof input.campaign !== 'string' || !CAMPAIGN.test(input.campaign) || typeof input.owner !== 'string' || !OWNER.test(input.owner)) {
        respond(response, 400, { error: 'Invalid request.' }); return;
      }
      let allowed = false;
      if (campaigns.has(input.campaign)) {
        try {
          const role = game.member({ campaign: input.campaign, owner: input.owner });
          allowed = role === 'host' || request.url === '/v1/authorize-participant' && role === 'player';
        }
        catch { /* Unknown members and unavailable membership data fail closed. */ }
      }
      respond(response, 200, { allowed });
    })().catch(() => respond(response, 400, { error: 'Invalid request.' }));
  });
  // Keep the byte-bounded raw list intact so excess headers cannot hide an
  // Origin/proxy/authentication header through Node's silent count truncation.
  server.maxHeadersCount = 0;
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 20;
  server.setTimeout(REQUEST_TIMEOUT, socket => socket.destroy());
  server.on('checkContinue', (request, response) => respond(response, authenticated(request, server, authorization) ? 400 : 401, { error: 'Invalid request.' }));
  server.on('checkExpectation', (request, response) => respond(response, authenticated(request, server, authorization) ? 400 : 401, { error: 'Invalid request.' }));
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('connect', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => {
    if (socket.writable && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}

/** Starts only on the literal IPv4 loopback address; never closes game. */
export async function startMembershipBridge({ game, token, campaigns, port = 38176 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw invalid();
  const server = createMembershipBridge({ game, token, campaigns });
  await new Promise((resolve, reject) => {
    const failed = () => { server.off('listening', started); reject(new Error('Membership bridge could not start.')); };
    const started = () => { server.off('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', started);
    server.listen(port, '127.0.0.1');
  });
  const address = server.address(); let closing;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      if (!closing) closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(new Error('Membership bridge could not close.')) : resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
