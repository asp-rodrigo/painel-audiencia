// Servidor local do Painel de Audiência.
// - Sincroniza periodicamente os posts de fifty5blue.com/pt/dados-de-audiencia (API pública do WordPress)
// - Guarda tudo em data/ (um arquivo por post)
// - Lê a grade comercial das planilhas .xlsx em planilhas/ (recarrega quando um arquivo muda)
// - Serve o dashboard em http://localhost:PORT
//
// Uso:  node server.js [--open]
// Variáveis: PORT (3000), SYNC_INTERVAL_MIN (60), REQUEST_DELAY_MS (10000)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.js';
import { sync } from './lib/sync.js';
import { loadComercial, attachIbope, comercialSignature } from './lib/comercial.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PLANILHAS = path.join(ROOT, 'planilhas');

const PORT = +(process.env.PORT ?? 3000);
const SYNC_INTERVAL_MIN = +(process.env.SYNC_INTERVAL_MIN ?? 60);
// O robots.txt do site pede "Crawl-delay: 10": respeitamos esse intervalo entre requisições.
const REQUEST_DELAY_MS = +(process.env.REQUEST_DELAY_MS ?? 10000);

const store = openStore(path.join(ROOT, 'data'));
const state = { syncing: false, progress: null, lastCheck: null, lastError: null };

// Grade comercial: relida só quando um .xlsx da pasta é adicionado, removido ou salvo de novo.
let comercialCache = { key: null, value: null };
function comercial() {
  const key = `${comercialSignature(PLANILHAS)}#${store.version()}`;
  if (comercialCache.key !== key) {
    comercialCache = { key, value: attachIbope(loadComercial(PLANILHAS), store.payload().tv.weeks) };
    for (const e of comercialCache.value.errors) console.error(`[planilhas] ${e.file}: ${e.message}`);
  }
  return comercialCache.value;
}

async function runSync(reason) {
  if (state.syncing) return;
  state.syncing = true;
  const started = new Date().toISOString();
  console.log(`[sync] início (${reason})`);
  try {
    const { tv, radio } = await sync(store, { delayMs: REQUEST_DELAY_MS, onProgress: (p) => (state.progress = p) });
    state.lastCheck = started;
    state.lastError = null;
    console.log(`[sync] ok — TV +${tv.added}/~${tv.updated}, Rádio +${radio.added}/~${radio.updated}`);
  } catch (err) {
    state.lastError = { at: started, message: err.message };
    console.error('[sync] erro:', err.message);
  } finally {
    state.syncing = false;
    state.progress = null;
  }
}

function scheduleSync() {
  setTimeout(async () => {
    await runSync('agendada');
    scheduleSync();
  }, SYNC_INTERVAL_MIN * 60000);
}

function statusPayload() {
  return {
    version: `${store.version()}#${comercialSignature(PLANILHAS)}`,
    lastCheck: state.lastCheck,
    lastError: state.lastError,
    syncing: state.syncing,
    progress: state.progress,
    intervalMin: SYNC_INTERVAL_MIN,
  };
}

// ---------------------------------------------------------------- HTTP

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function send(req, res, status, body, type) {
  const headers = { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' };
  if (body.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    headers['Content-Encoding'] = 'gzip';
    body = zlib.gzipSync(body);
  }
  res.writeHead(status, headers);
  res.end(body);
}

const json = (req, res, obj, status = 200) => send(req, res, status, JSON.stringify(obj), 'application/json');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/data') {
      return json(req, res, { ...store.payload(), comercial: comercial(), meta: statusPayload() });
    }
    if (url.pathname === '/api/status') return json(req, res, statusPayload());
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      if (state.syncing) return json(req, res, { started: false, ...statusPayload() }, 409);
      runSync('manual');
      return json(req, res, { started: true, ...statusPayload() }, 202);
    }

    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(req, res, 404, 'Não encontrado', 'text/plain');
    }
    send(req, res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
  } catch (err) {
    console.error(err);
    json(req, res, { error: err.message }, 500);
  }
});

const openBrowser = () => process.argv.includes('--open') && exec(`open http://localhost:${PORT}`);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`A porta ${PORT} já está em uso — o painel provavelmente já está rodando.`);
    openBrowser();
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Painel de Audiência em http://localhost:${PORT}`);
  console.log(`Verificando novas postagens a cada ${SYNC_INTERVAL_MIN} min. Ctrl+C para encerrar.`);
  openBrowser();
  runSync('inicial').then(scheduleSync);
});
