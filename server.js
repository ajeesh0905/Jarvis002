// Node server (self-hosting / local testing). Cloudflare uses src/worker.js instead.
// Needs Node >= 22.13 (built-in node:sqlite). No npm install required.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './src/app.js';
import { nodeDb } from './src/db-node.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const PUBLIC_DIR = path.join(here, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const handle = createHandler({ db: nodeDb(path.join(DATA_DIR, 'orders.db'), path.join(here, 'src', 'schema.sql')), env: process.env });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

async function toRequest(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 2e6) break; chunks.push(c); }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request('http://' + (req.headers.host || 'localhost') + req.url, { method: req.method, headers: req.headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  try {
    if (pathname.startsWith('/api/')) {
      const r = await handle(await toRequest(req));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const full = path.normalize(path.join(PUBLIC_DIR, PAGES[pathname] || pathname.slice(1)));
    if (!full.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error(e); res.writeHead(500); res.end('Server error');
  }
});
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Ruchi Food Products running on http://localhost:${PORT}  (admin: /admin)`));
