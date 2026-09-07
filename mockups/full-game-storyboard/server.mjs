import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.jpg':'image/jpeg', '.png':'image/png', '.json':'application/json', '.md':'text/plain; charset=utf-8' };
createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://localhost'); const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw new Error('Not found');
    const bytes = await readFile(path);
    const presentationHash = url.pathname === '/presentation.html' ? JSON.parse(await readFile(resolve(root,'presentation-script-hash.json'),'utf8')).sha256 : null;
    res.writeHead(200, { 'Content-Type':mime[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'${presentationHash?` 'sha256-${presentationHash}'`:''}; connect-src 'none'; media-src 'none'; frame-ancestors 'none'` });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4186, '127.0.0.1', () => console.log('Storyboard: http://localhost:4186 · isolated local demonstration'));
