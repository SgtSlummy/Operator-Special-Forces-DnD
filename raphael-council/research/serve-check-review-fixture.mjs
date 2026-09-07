import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const fixtureRoot = fileURLToPath(new URL('./check-review-fixture/', import.meta.url));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const host = '127.0.0.1';
const port = 49719;
const server = await createServer({
  configFile: false,
  root: fixtureRoot,
  publicDir: false,
  envDir: fixtureRoot,
  envPrefix: [],
  cacheDir: resolve(projectRoot, 'node_modules/.vite/check-review-fixture'),
  plugins: [react(), {
    name: 'isolated-check-review-fixture',
    configureServer(viteServer) {
      viteServer.middlewares.use((request, response, next) => {
        if (request.url === '/api' || request.url?.startsWith('/api/')) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end('This fixture has no API server.');
          return;
        }
        next();
      });
    },
  }],
  server: {
    host,
    port,
    strictPort: true,
    open: false,
    cors: false,
    hmr: { host },
    fs: {
      strict: true,
      allow: [fixtureRoot, resolve(projectRoot, 'app/play'), resolve(projectRoot, 'client'), resolve(projectRoot, 'node_modules')],
    },
  },
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
await server.listen();
process.stdout.write(`Check review browser fixture: http://${host}:${port}/\n`);
