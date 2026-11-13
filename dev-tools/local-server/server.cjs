'use strict';
// Local-only development server for the Challenge difficulty editor.
//   npm run dev       editor + test game + save API on http://127.0.0.1:4317
//   npm run preview   serves the built dist/ folder exactly as Cloudflare Pages would (read-only)
// Binds to 127.0.0.1 only, rejects foreign Host/Origin headers, and can write exactly one file.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {ROOT, CONFIG_PATH, readConfig, readBaseline, writeConfig, loadRules} = require('./config-file.cjs');
const {RUNTIME_FILES} = require('../build.cjs');

const HOST = '127.0.0.1';
const args = new Set(process.argv.slice(2));
const PREVIEW = args.has('--preview');
const START_PORT = Number(process.env.PORT) || (PREVIEW ? 4318 : 4317);
const EDITOR_DIR = path.join(ROOT, 'dev-tools/difficulty-editor');
const DIST = path.join(ROOT, 'dist');
const MAX_BODY = 64 * 1024;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8'};
const EDITOR_FILES = ['index.html', 'editor.css', 'editor.js', 'test-harness.js'];
let port = START_PORT;

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', ...extra});
  res.end(body);
}
const json = (res, status, data) => send(res, status, JSON.stringify(data), TYPES['.json']);
function file(res, filePath) {
  fs.readFile(filePath, (error, data) => error ? send(res, 404, 'Not found') : send(res, 200, data, TYPES[path.extname(filePath)] || 'application/octet-stream'));
}

// Defeats DNS-rebinding and cross-site requests: only this machine's own page may talk to us.
function trusted(req) {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowed.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || allowed.some(h => origin === `http://${h}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    // Oversized bodies are drained and discarded (not buffered) so the client still gets a clean 413.
    req.on('data', chunk => { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); });
    req.on('end', () => size > MAX_BODY ? reject(Object.assign(new Error('Request too large'), {status: 413})) : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function configPayload() {
  return {config: readConfig(), baseline: readBaseline(), file: path.relative(ROOT, CONFIG_PATH), savedAt: fs.statSync(CONFIG_PATH).mtime.toISOString()};
}

// The test page is the real game plus one injected harness script; nothing is written to disk.
function testPage(res) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const marker = '<script src="game.js" defer></script>';
  if (!html.includes(marker)) return send(res, 500, 'index.html no longer loads game.js as expected');
  send(res, 200, html.replace(marker, `<script src="/editor/test-harness.js" defer></script>\n${marker}`).replace('<title>', '<title>[TEST] '), TYPES['.html']);
}

async function devRoute(req, res, url) {
  const p = url.pathname;
  if (p === '/' ) return send(res, 302, '', undefined, {Location: '/editor/'});
  if (p === '/api/config' && req.method === 'GET') return json(res, 200, configPayload());
  if (p === '/api/config' && req.method === 'POST') {
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return json(res, 415, {ok: false, error: 'Expected JSON'});
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (error) { return json(res, error.status || 400, {ok: false, error: error.status ? error.message : 'Request was not valid JSON'}); }
    try {
      const {backup} = writeConfig(body?.config, loadRules());
      console.log(`  ✓ Saved challenge-config.js (backup: ${backup})`);
      return json(res, 200, {ok: true, backup, ...configPayload()});
    } catch (error) {
      if (error.validation) return json(res, 422, {ok: false, error: 'Settings were rejected; challenge-config.js was not changed.', errors: error.validation});
      console.error('  ✗ Save failed:', error);
      return json(res, 500, {ok: false, error: `Save failed; challenge-config.js was not changed. ${error.message}`});
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (p === '/editor') return send(res, 302, '', undefined, {Location: '/editor/'});
  if (p === '/editor/') return file(res, path.join(EDITOR_DIR, 'index.html'));
  if (p.startsWith('/editor/') && EDITOR_FILES.includes(p.slice(8))) return file(res, path.join(EDITOR_DIR, p.slice(8)));
  if (p === '/game' ) return send(res, 302, '', undefined, {Location: '/game/'});
  if (p === '/game/') return testPage(res);
  if (p.startsWith('/game/') && RUNTIME_FILES.includes(p.slice(6))) return file(res, path.join(ROOT, p.slice(6)));
  send(res, 404, 'Not found');
}

function previewRoute(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  // Only files that exist directly in dist/ are served; no traversal, no directories.
  if (!/^[\w.-]+$/.test(name) || !fs.existsSync(path.join(DIST, name))) return send(res, 404, 'Not found');
  file(res, path.join(DIST, name));
}

const server = http.createServer(async (req, res) => {
  try {
    if (!trusted(req)) return send(res, 403, 'Forbidden: local requests only');
    const url = new URL(req.url, `http://${HOST}:${port}`);
    await (PREVIEW ? previewRoute : devRoute)(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, {ok: false, error: error.message});
  }
});

if (PREVIEW && !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('\n  ✗ dist/ has not been built yet. Run: npm run build\n'); process.exit(1);
}
if (!PREVIEW) {
  const check = loadRules().validate(readConfig());
  if (!check.ok) console.warn(`\n  ! challenge-config.js is currently invalid:\n    - ${check.errors.join('\n    - ')}\n`);
}

server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < START_PORT + 10) { port++; server.listen(port, HOST); }
  else { console.error(`\n  ✗ Could not start server: ${error.message}\n`); process.exit(1); }
});
server.listen(port, HOST, () => {
  const url = `http://${HOST}:${port}/${PREVIEW ? '' : 'editor/'}`;
  console.log(PREVIEW
    ? `\n  Production preview of dist/ (read-only): ${url}\n  Press Ctrl+C to stop.\n`
    : `\n  MINEFIELD difficulty editor (local only): ${url}\n  Game test page: http://${HOST}:${port}/game/\n  Saves write only: ${path.relative(ROOT, CONFIG_PATH)}  (backups in dev-tools/backups/)\n  Press Ctrl+C to stop.\n`);
  if (process.platform === 'darwin' && !args.has('--no-open') && !process.env.NO_OPEN) execFile('open', [url], () => {});
});
