import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getImageService, imageConfig } from './runtime.mjs';
import { ObusTransport } from '../ai/obus.mjs';

export async function main(args = process.argv.slice(2)) {
  const [command, first, second] = args;
  if (command === 'check') {
    const capabilities = await new ObusTransport().capabilities().catch(() => null);
    console.log(JSON.stringify({ ...imageConfig(), aiBackend: 'obus', obusAvailable: Boolean(capabilities), imageProviderConfigured: capabilities?.image_routes === true,
      discordConfigured: Boolean(process.env.DISCORD_TOKEN?.trim()), localNodeHost: process.env.RAPHAEL_LOCAL_HOST === '1' }, null, 2));
    return;
  }
  const service = getImageService();
  try {
    if (command === 'publish' && first && args.length === 2) {
      const record = JSON.parse((await readFile(resolve(first), 'utf8')).replace(/^\uFEFF/, ''));
      const scene = service.publishScene(record);
      console.log(`Published observable scene ${scene.id}, revision ${scene.revision}. No game action or time was changed.`);
    } else if (command === 'access' && first && second && args.length === 3) {
      console.log(service.issueBrowserAccess({ campaign: first, owner: second }));
      console.log('Give this code privately to that player. It expires in 30 days. Do not put it in a URL or a public channel.');
    } else if (command === 'revoke' && first && second && args.length === 3) {
      service.revokeAccess({ campaign: first, owner: second }); console.log('Browser access revoked for that player.');
    } else if (command === 'rejoin-party' && first && second && args.length === 3) {
      service.clearPrivateScene({ campaign: first, owner: second }); console.log('This player now uses the shared party view.');
    } else throw new Error('Use images:host check | publish <scene.json> | access <campaign> <player> | revoke <campaign> <player> | rejoin-party <campaign> <player>.');
  } finally { await service.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
