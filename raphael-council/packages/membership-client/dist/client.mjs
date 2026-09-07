// Server-side client for Davy's injected authorization callback. Never ship the
// service credential to an Activity/browser or fall back to cached membership.
const campaignId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const ownerId = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const credential = value => typeof value === 'string' && /^[!-~]{32,512}$/.test(value);

export function createMembershipClient({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  // Validate the original spelling too: URL normalizes nonliteral IP spellings.
  if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?\/?$/.test(url) || !credential(token) || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) {
    throw new TypeError('Configure a private loopback membership service and a valid service credential.');
  }
  let base;
  try { base = new URL(url); } catch { throw new TypeError('Configure a private loopback membership service.'); }
  const origin = base.origin;
  async function request(path, input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader;
    try {
      const target = `${origin}${path}`;
      const response = await fetchImpl(target, {
        method: input ? 'POST' : 'GET', redirect: 'manual', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(input ? { 'content-type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      if (response.status !== 200 || response.redirected || response.url && response.url !== target || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return null;
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) return null;
      if (!response.body || typeof response.body.getReader !== 'function') return null;
      reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) return null;
        chunks.push(value);
      }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
      return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
    } catch { return null; }
    finally {
      clearTimeout(timer); controller.abort();
      try { await reader?.cancel(); } catch { /* Failed reads never authorize. */ }
    }
  }
  return Object.freeze({
    async authorizeCommand(scope) {
      if (!campaignId(scope?.campaign) || !ownerId(scope?.owner)) return false;
      const result = await request('/v1/authorize-command', { campaign: scope.campaign, owner: scope.owner });
      return result?.allowed === true && Object.keys(result).length === 1;
    },
    async authorizeParticipant(scope) {
      if (!campaignId(scope?.campaign) || !ownerId(scope?.owner)) return false;
      const result = await request('/v1/authorize-participant', { campaign: scope.campaign, owner: scope.owner });
      return result?.allowed === true && Object.keys(result).length === 1;
    },
    async status() {
      const result = await request('/v1/status');
      return result?.ready === true && result.service === 'operator-membership' && result.version === 1 && Object.keys(result).length === 3;
    },
  });
}
