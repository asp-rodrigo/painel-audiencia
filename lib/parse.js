// Extrai os dados das tabelas HTML publicadas em fifty5blue.com/pt/dados-de-audiencia.
// Sem dependências: as tabelas do WordPress são regulares o bastante para um parser simples.

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—' };

export function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function cellText(html) {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(s) {
  const t = s.replace(/\s/g, '');
  if (!/^-?[\d.]*,?\d+$/.test(t)) return null;
  return Number(t.replace(/\./g, '').replace(',', '.'));
}

// Converte uma <table> em matriz, expandindo rowspan/colspan.
function tableGrid(tableHtml) {
  const grid = [];
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of row[1].matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      while (grid[r][c] !== undefined) c++;
      const rs = +(cell[2].match(/rowspan="(\d+)"/)?.[1] ?? 1);
      const cs = +(cell[2].match(/colspan="(\d+)"/)?.[1] ?? 1);
      const text = cellText(cell[3]);
      for (let i = 0; i < rs; i++) {
        grid[r + i] ??= [];
        for (let j = 0; j < cs; j++) grid[r + i][c + j] = text;
      }
      c += cs;
    }
  });
  return grid;
}

function tables(html) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
}

// ---------------------------------------------------------------- TV

const TV_MARKETS = [
  [/15\s*(praças|mercados)|PNT/i, 'PNT', 'PNT (15 praças)'],
  [/S[ÃĂA]O PAULO/i, 'GSP', 'Grande São Paulo'],
  [/RIO DE JANEIRO/i, 'GRJ', 'Grande Rio de Janeiro'],
  [/BEL[ÉE]M/i, 'BEL', 'Grande Belém'],
  [/BELO HORIZONTE/i, 'BHZ', 'Grande Belo Horizonte'],
  [/CAMPINAS/i, 'CAM', 'Grande Campinas'],
  [/CURITIBA/i, 'CTA', 'Grande Curitiba'],
  [/DISTRITO FEDERAL/i, 'DFE', 'Distrito Federal'],
  [/FLORIAN/i, 'FLO', 'Grande Florianópolis'],
  [/FORTALEZA/i, 'FOR', 'Grande Fortaleza'],
  [/GOI[AÂ]NIA/i, 'GOI', 'Grande Goiânia'],
  [/MANAUS/i, 'MAN', 'Manaus'],
  [/PORTO ALEGRE/i, 'POA', 'Grande Porto Alegre'],
  [/RECIFE/i, 'REC', 'Grande Recife'],
  [/SALVADOR/i, 'SAL', 'Grande Salvador'],
  [/VIT[ÓO]RIA/i, 'GVI', 'Grande Vitória'],
];
export const TV_MARKET_LABELS = Object.fromEntries(TV_MARKETS.map(([, code, label]) => [code, label]));

function tvMarket(text) {
  return TV_MARKETS.find(([re]) => re.test(text))?.[1] ?? null;
}

const NETWORKS = [[/REDE ?TV/, 'REDE TV!'], [/GLOBO/, 'GLOBO'], [/RECORD/, 'RECORD'], [/SBT/, 'SBT'], [/BAND/, 'BAND']];

function normalizeNetwork(s) {
  const t = s.toUpperCase().replace(/\s+/g, ' ').trim();
  return NETWORKS.find(([re]) => re.test(t))?.[1] ?? t;
}

// "12/10/26 a 18/10/26", "21/06 a 27/06/2021", "18/06 a 24/06/2018"
export function parsePeriod(text) {
  const m = decode(text).match(
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:a|à|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i,
  );
  if (!m) return null;
  const year = (y) => (y.length === 2 ? 2000 + +y : +y);
  const ey = year(m[6]);
  let sy = m[3] ? year(m[3]) : ey;
  if (!m[3] && +m[2] > +m[5]) sy -= 1;
  if (+m[5] < +m[2] && ey <= sy) return parsePeriod(`${m[1]}/${m[2]}/${sy} a ${m[4]}/${m[5]}/${sy + 1}`);
  const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { start: iso(sy, +m[2], +m[1]), end: iso(ey, +m[5], +m[4]) };
}

// Retorna { start, end, units: { PNT: { ind, cov }, ... }, rows: [{ network, rank, program, v: { PNT: [dom, ind, cov], ... } }] }
export function parseTvPost(post) {
  const html = post.content?.rendered ?? '';
  const title = decode(post.title?.rendered ?? '');
  // A nota de rodapé ("De 19/10/2026 a 25/10/2026") é mais confiável que o título, que às vezes tem erro de digitação.
  const candidates = [
    parsePeriod(html.match(/De (\d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4})/)?.[1] ?? ''),
    parsePeriod(title),
  ].filter(Boolean);
  const isWeek = (p) => (Date.parse(p.end) - Date.parse(p.start)) / 864e5 === 6;
  const period = candidates.find(isWeek) ?? candidates[0];
  if (!period) return null;

  const rows = [];
  const units = {};
  for (const t of tables(html)) {
    const grid = tableGrid(t);
    if (grid.length < 3) continue;
    const network = normalizeNetwork(grid[0][0] ?? '');
    const firstData = grid.findIndex((r) => r.length > 3 && r.slice(1).every((c) => c === '' || parseNumber(c) !== null) && r.slice(1).some((c) => parseNumber(c) !== null));
    if (!network || firstData < 1) continue;

    // Linha de cabeçalho com os nomes das praças (colspan=3 cada).
    const head = grid.slice(0, firstData);
    const distinctMarkets = (r) => new Set(r.map((c) => (/ranking/i.test(c ?? '') ? null : tvMarket(c ?? ''))).filter(Boolean)).size;
    const marketRow = head.reduce((best, r) => (distinctMarkets(r) > distinctMarkets(best) ? r : best), head[1] ?? head[0]);
    const unitRow = head[head.length - 1];
    const cols = [];
    for (let j = 1; j < (marketRow?.length ?? 0); j++) {
      const code = tvMarket(marketRow[j] ?? '');
      if (!code) continue;
      const idx = cols.filter((c) => c.code === code).length;
      if (idx < 3) cols.push({ j, code, idx });
    }
    if (!cols.length) continue;
    // As unidades variam por praça (ex.: 2018 = PNT em %, praças em milhares).
    const label = (c) => (c ? (unitRow[c.j] ?? '').replace(/\s+/g, ' ').trim() : '');
    for (const code of new Set(cols.map((c) => c.code))) {
      if (units[code]) continue;
      const [, ind, cov] = [0, 1, 2].map((i) => cols.find((c) => c.code === code && c.idx === i));
      // Alguns posts antigos não têm a linha de unidades; nesse caso a magnitude do valor indica a unidade.
      const sample = (c) => parseNumber(grid[firstData][c?.j] ?? '') ?? 0;
      const unit = (c, kind) => {
        const l = label(c);
        if (new RegExp(kind, 'i').test(l)) return /#/.test(l) ? `${kind}#` : `${kind}%`;
        return sample(c) >= 50 ? `${kind}#` : `${kind}%`;
      };
      units[code] = { ind: unit(ind, 'Rat'), cov: unit(cov, 'Cov') };
    }

    let rank = 0;
    for (const r of grid.slice(firstData)) {
      const program = (r[0] ?? '').trim();
      if (!program || r.slice(1).every((c) => parseNumber(c ?? '') === null)) continue;
      const v = {};
      for (const c of cols) {
        (v[c.code] ??= [null, null, null])[c.idx] = parseNumber(r[c.j] ?? '');
      }
      rows.push({ network, rank: ++rank, program, v });
    }
  }
  if (!rows.length) return null;
  return { ...period, units, rows };
}

// ---------------------------------------------------------------- Rádio

export const RADIO_MARKET_LABELS = {
  GSP: 'Grande São Paulo', GRJ: 'Grande Rio de Janeiro', BHZ: 'Grande Belo Horizonte',
  POA: 'Grande Porto Alegre', CTA: 'Grande Curitiba', DFE: 'Distrito Federal',
  FLO: 'Grande Florianópolis', FOR: 'Grande Fortaleza', REC: 'Grande Recife',
  SAL: 'Grande Salvador', GVI: 'Grande Vitória', GOI: 'Grande Goiânia', CAM: 'Grande Campinas',
};

const MONTHS = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };

// Linhas no formato "GSP – JUN/2026 A SET/2026 | total emissoras | total rádio | AM | FM | WEB"
export function parseRadioPost(post) {
  const html = post.content?.rendered ?? '';
  const out = [];
  for (const t of tables(html)) {
    for (const r of tableGrid(t)) {
      const m = (r[0] ?? '').match(/^([A-Z]{3})\s*[–-]\s*([A-Z]{3})\/(\d{4})\s*[AÀ]\s*([A-Z]{3})\/(\d{4})/i);
      if (!m || !MONTHS[m[2].toUpperCase()] || !MONTHS[m[4].toUpperCase()]) continue;
      const vals = r.slice(1, 6).map((c) => parseNumber(c ?? ''));
      if (vals.length < 5 || vals.some((x) => x === null)) continue;
      const ym = (mon, y) => `${y}-${String(MONTHS[mon.toUpperCase()]).padStart(2, '0')}`;
      const [total, radio, am, fm, web] = vals;
      out.push({
        market: m[1].toUpperCase(),
        start: ym(m[2], m[3]),
        end: ym(m[4], m[5]),
        // Até 2022 os dados eram publicados como índice de audiência (%); depois, em ouvintes por minuto (OPM#).
        unit: total > 100 ? 'OPM' : 'IA%',
        total, radio, am, fm, web,
      });
    }
  }
  return out;
}
