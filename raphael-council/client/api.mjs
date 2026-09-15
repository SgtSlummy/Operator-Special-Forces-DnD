/** All game resources stay on the current origin. Discord's proxy forwards
 * /.proxy/api/... through the application's root URL mapping to /api/....
 * Local browser development and the standalone web UI use /api/... directly.
 * This selects a transport path only; the server still verifies identity. */
export function apiPath(path, location = globalThis.location) {
  if (typeof path !== 'string' || !/^\/api(?:\/|\?|$)/.test(path) || /[\\\r\n]/.test(path)) {
    throw new TypeError('Expected an application API path');
  }
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname.split('/').some(part => ['.', '..'].includes(decodeURIComponent(part)))) {
    throw new TypeError('Invalid API path');
  }
  if (/^\/api\/(?:auth|hollow-lantern)(?:\/|$)/.test(pathname)) {
    const url = new URL(path, 'http://application.invalid');
    const explicit = url.searchParams.has('campaignId');
    const campaigns = explicit ? url.searchParams.getAll('campaignId') : new URLSearchParams(location?.search || '').getAll('campaignId');
    if (campaigns.length > 1 || campaigns.some(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
      throw new TypeError('Choose one valid campaign');
    }
    if (!explicit && campaigns.length === 1) {
      url.searchParams.append('campaignId', campaigns[0]);
      path = url.pathname + url.search + url.hash;
    }
  }
  const embedded = /^\d+\.discordsays\.com$/.test(location?.hostname || '');
  return `${embedded ? '/.proxy' : ''}${path}`;
}

/** @param {string} path @param {RequestInit} [options] */
export function apiFetch(path, options = {}) {
  return globalThis.fetch(apiPath(path), { credentials: 'same-origin', ...options });
}
