// SPORTZ server — serves the static front-end and the JSON API on one port.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi, readJson, ensureDemo } = require('./api');
const { refreshGames } = require('./sports');
const { settleDuePredictions } = require('./settle');

// ---- minimal .env loader (no dependency) ----
try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch (_) {}

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    return send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream');
  }
  // SPA fallback
  const idx = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(idx)) return send(res, 200, fs.readFileSync(idx), MIME['.html']);
  return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
    return handleApi(req, res).then(r => send(res, r.status, JSON.stringify(r.json)));
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const body = await readJson(req);
    req.body = body;
    return handleApi(req, res).then(r => send(res, r.status, JSON.stringify(r.json)));
  }
  // non-API: static / SPA
  return serveStatic(req, res, url.pathname);
});

async function boot() {
  ensureDemo();
  try {
    const { usedFallback } = await refreshGames();
    console.log(`[sports] provider=${process.env.SPORTS_PROVIDER || 'espn'} fallbackUsed=${usedFallback}`);
  } catch (e) {
    console.error('[sports] initial refresh failed:', e.message);
  }
  const settled = settleDuePredictions();
  console.log(`[boot] settled=${settled}`);
  server.listen(PORT, () => console.log('SPORTZ listening on http://localhost:' + PORT));
}

// Background jobs
setInterval(() => refreshGames().catch(() => {}), 5 * 60 * 1000);
setInterval(() => settleDuePredictions(), 2 * 60 * 1000);

boot();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));