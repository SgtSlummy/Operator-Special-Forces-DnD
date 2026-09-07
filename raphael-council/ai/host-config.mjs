import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createObusHostControl } from './host-control.mjs';
import { AiError, ObusTransport } from './obus.mjs';

// Called only by trusted game-host composition or an authenticated GM mutation.
// Ordinary consumers and portable Davy packages never load the host credential.
export function createLocalObusHostControl({ transport = new ObusTransport(), env = process.env } = {}) {
  try {
    const literal = env.RAPHAEL_OBUS_HOST_CONTROL_TOKEN;
    const explicitFile = env.RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE;
    if (literal !== undefined && explicitFile !== undefined) throw new Error('Exclusive credential sources required.');
    let hostControlToken = literal;
    if (hostControlToken === undefined) {
      const file = explicitFile ?? join(homedir(), '.occultbus', 'game-agent', 'host-control-token');
      if (!isAbsolute(file)) throw new Error('Absolute credential path required.');
      const stat = statSync(file);
      if (!stat.isFile() || stat.size < 64 || stat.size > 66) throw new Error('Invalid credential file.');
      hostControlToken = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    }
    if (typeof hostControlToken !== 'string' || !/^[0-9a-f]{64}$/.test(hostControlToken)) throw new Error('Invalid credential.');
    const headers = transport.headers();
    const serviceToken = new Headers(headers).get('X-Obus-Game-Token');
    return createObusHostControl({ url: transport.url, serviceToken, hostControlToken });
  } catch {
    throw new AiError('Configure the private Obus game host credential before changing AI settings.');
  }
}
