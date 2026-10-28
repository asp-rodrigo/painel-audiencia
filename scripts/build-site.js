// Gera a versão estática do painel (para GitHub Pages) na pasta dist/.
//
// Uso:  node scripts/build-site.js [--no-sync]
//   --no-sync  usa só os dados já salvos em data/, sem consultar o site
//
// No GitHub Actions, informa em $GITHUB_OUTPUT se chegaram posts novos (changed=true|false).
//
// A grade comercial (planilhas/) é interna e fica FORA do site por padrão. Para incluí-la de
// propósito: INCLUIR_COMERCIAL=1 node scripts/build-site.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.js';
import { sync } from '../lib/sync.js';
import { loadComercial, attachIbope } from '../lib/comercial.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const REQUEST_DELAY_MS = +(process.env.REQUEST_DELAY_MS ?? 10000);

const store = openStore(path.join(ROOT, 'data'));
let changed = false;

if (!process.argv.includes('--no-sync')) {
  try {
    const { tv, radio, changed: c } = await sync(store, { delayMs: REQUEST_DELAY_MS, onProgress: (p) => console.log(`[sync] ${p}`) });
    changed = c;
    console.log(`[sync] ok — TV +${tv.added}/~${tv.updated}, Rádio +${radio.added}/~${radio.updated}`);
  } catch (err) {
    // Falha visível no GitHub Actions (o dono do repositório recebe um e-mail); o site publicado continua como estava.
    console.error(`[sync] erro: ${err.message}`);
    process.exit(1);
  }
}

const now = new Date().toISOString();
const status = { version: store.version(), lastCheck: now, static: true };

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });

// O front-end lê os dados de arquivos estáticos em vez da API do servidor local.
const indexFile = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexFile, 'utf8');
fs.writeFileSync(indexFile, html.replace('</head>', '  <meta name="static-data" content="data.json" />\n</head>'));
const comercial = process.env.INCLUIR_COMERCIAL === '1'
  ? attachIbope(loadComercial(path.join(ROOT, 'planilhas')), store.payload().tv.weeks)
  : undefined;
if (comercial) console.log(`Incluindo a grade comercial (${comercial.rows.length} linhas) no site.`);
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ ...store.payload(), comercial, meta: status }));
fs.writeFileSync(path.join(OUT, 'status.json'), JSON.stringify(status));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
console.log(`Site gerado em dist/ (${store.payload().tv.weeks.length} semanas de TV, ${store.payload().radio.rows.length} registros de rádio)`);
