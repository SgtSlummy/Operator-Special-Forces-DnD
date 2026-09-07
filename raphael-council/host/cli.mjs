import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWebHostSupervisor } from './supervisor.mjs';
import { openGameAiHostServices } from './ai-services.mjs';

/** Explicit integrated host entry; importing this module never starts a service. */
export async function runGameHost({ argv = process.argv.slice(2), env = process.env,
  createSupervisor = createWebHostSupervisor, openAiServices = openGameAiHostServices,
  report = message => console.error(message), ...supervisorOptions } = {}) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) throw new Error('Expected a game host command.');
  const [mode = 'start', ...args] = argv;
  if (!['dev', 'build', 'start'].includes(mode)) throw new Error('Usage: node host/cli.mjs dev|build|start [web options]');
  const supervisor = createSupervisor({ ...supervisorOptions, mode, args, env, report,
    openHostServices: async ({ signal } = {}) => {
      const services = await openAiServices({ env, signal });
      if (services.status().state === 'unavailable') report('Obus game-host authorization is unavailable. The web application will start with manual play.');
      return services;
    } });
  await supervisor.start();
  return supervisor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runGameHost().catch(() => { console.error('Game host startup failed. Use: node host/cli.mjs dev|build|start [web options]'); process.exitCode = 1; });
}
