// Grade comercial (preço × audiência) a partir das planilhas .xlsx da pasta planilhas/.
// Cada aba é uma emissora em um mês, ex.: "SBT JANEIRO 2024", "RECORD Maio 2024".

import fs from 'node:fs';
import path from 'node:path';
import { readXlsx } from './xlsx.js';

const MONTHS = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim().replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

// "Novela Noite 1 - A Gata (ATÉ DIA 12)" → "NOVELA NOITE 1 - A GATA": identifica o programa entre meses.
export const programKey = (name) =>
  plain(name)
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/&/g, 'E')
    .replace(/\s*-?\s*ED\.? DE SABADO$/, ' ED SB') // "Ed. de Sábado" é como o IBOPE chama "ED SB"
    .replace(/\s+/g, ' ')
    .trim();

// Sufixos que o IBOPE acrescenta ao nome: "A PRACA E NOSSA NOT", "DOMINGO LEGAL PSS".
const IBOPE_SUFFIX = /\s+(NOT|VES|MAT|PSS|SS)$/;
const ibopeKey = (name) => {
  let k = programKey(name);
  while (IBOPE_SUFFIX.test(k)) k = k.replace(IBOPE_SUFFIX, '');
  return k;
};

// Acrescenta a cada linha a audiência domiciliar do mesmo programa em Grande São Paulo no ranking
// público do IBOPE (média das semanas do mês). Só existe para programas que entraram no Top 10.
export function attachIbope(comercial, tvWeeks) {
  const byKey = new Map();
  for (const w of tvWeeks) {
    for (const r of w.rows) {
      const v = r.v.GSP?.[0];
      if (v == null || (r.network !== 'SBT' && r.network !== 'RECORD')) continue;
      const k = `${r.network}|${w.end.slice(0, 7)}|${ibopeKey(r.program)}`;
      const acc = byKey.get(k) ?? { sum: 0, n: 0 };
      acc.sum += v;
      acc.n += 1;
      byKey.set(k, acc);
    }
  }
  for (const r of comercial.rows) {
    const acc = byKey.get(`${r.network}|${r.period}|${r.key}`);
    r.ibope = acc ? { gsp: acc.sum / acc.n, semanas: acc.n } : null;
  }
  return comercial;
}

function sheetPeriod(name) {
  const p = plain(name);
  const m = MONTHS.findIndex((mon) => p.includes(mon));
  const y = p.match(/\b(20\d{2})\b/)?.[1];
  return m >= 0 && y ? `${y}-${String(m + 1).padStart(2, '0')}` : null;
}

// Abas sem mês e ano no nome (ex.: "SBT") ficam fora da linha do tempo.
export const NO_PERIOD = 'sem-mes';

export const periodLabel = (key) => {
  if (key === NO_PERIOD) return 'Aba sem mês';
  const [y, m] = key.split('-');
  return `${SHORT[m - 1]}/${y}`;
};

function parseTime(v) {
  const m = String(v ?? '').match(/(\d{1,2})\s*[hH:]\s*(\d{2})?/);
  if (!m) return { hora: null, minutos: null };
  const h = +m[1];
  const min = +(m[2] ?? 0);
  return { hora: `${String(h).padStart(2, '0')}h${String(min).padStart(2, '0')}`, minutos: h * 60 + min };
}

function daypart(minutos) {
  if (minutos == null) return null;
  const h = Math.floor(minutos / 60);
  if (h < 5) return 'Madrugada';
  if (h < 12) return 'Manhã';
  if (h < 18) return 'Tarde';
  return 'Noite';
}

function dayGroup(dia) {
  const d = plain(dia);
  if (d.startsWith('SAB')) return 'Sábado';
  if (d.startsWith('DOM')) return 'Domingo';
  return 'Segunda a sexta';
}

function parseSheet(sheet, file) {
  const network = ['SBT', 'RECORD'].find((n) => plain(sheet.name).includes(n) || plain(sheet.rows[0]?.[0]).includes(n));
  if (!network) return [];
  const headerAt = sheet.rows.findIndex((r) => r.some((c) => plain(c) === 'PROGRAMA'));
  if (headerAt < 0) return [];
  const col = {};
  sheet.rows[headerAt].forEach((c, i) => {
    const h = plain(c);
    if (h === 'DIA') col.dia = i;
    else if (h === 'HORA') col.hora = i;
    else if (h === 'PROGRAMA') col.programa = i;
    else if (h.includes('SAO PAULO')) col.preco = i;
    else if (h.includes('VALOR')) col.valor = i;
    else if (h.includes('PONTOS')) col.pontos = i;
    else if (h === 'CPM') col.cpm = i;
  });

  const period = sheetPeriod(sheet.name) ?? NO_PERIOD;
  const out = [];
  let lastDia = null;
  for (const r of sheet.rows.slice(headerAt + 1)) {
    const programa = String(r[col.programa] ?? '').replace(/\s+/g, ' ').trim();
    if (!programa) continue;
    // Linhas seguidas do mesmo dia deixam a coluna DIA em branco.
    const dia = String(r[col.dia] ?? '').trim() || lastDia;
    lastDia = dia;
    const { hora, minutos } = parseTime(r[col.hora]);
    const preco = toNumber(r[col.preco]);
    const valor = toNumber(r[col.valor]);
    const pontos = toNumber(r[col.pontos]);
    out.push({
      network,
      period,
      sheet: sheet.name.trim(),
      file,
      dia,
      diaGrupo: dayGroup(dia),
      hora,
      minutos,
      faixa: daypart(minutos),
      programa,
      key: programKey(programa),
      preco,
      valor,
      pontos,
      cpp: valor != null && pontos ? valor / pontos : null,
      cpm: col.cpm != null ? toNumber(r[col.cpm]) : null,
    });
  }
  return out;
}

// Lê todas as planilhas da pasta. Quando duas abas trazem a mesma emissora e o mesmo mês,
// fica a do arquivo modificado por último.
export function loadComercial(dir) {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$')).map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    : [];
  files.sort((a, b) => a.mtime - b.mtime);

  const bySheet = new Map();
  const errors = [];
  for (const { f } of files) {
    try {
      for (const sheet of readXlsx(path.join(dir, f))) {
        const rows = parseSheet(sheet, f);
        if (!rows.length) continue;
        const id = `${rows[0].network}|${rows[0].period}|${rows[0].period === NO_PERIOD ? sheet.name.trim() : ''}`;
        bySheet.set(id, rows);
      }
    } catch (err) {
      errors.push({ file: f, message: err.message });
    }
  }
  const rows = [...bySheet.values()].flat();
  const periods = [...new Set(rows.map((r) => r.period))].sort((a, b) => (a === NO_PERIOD ? -1 : b === NO_PERIOD ? 1 : a.localeCompare(b)));
  return {
    rows,
    periods: periods.map((key) => ({ key, label: periodLabel(key) })),
    files: files.map(({ f, mtime }) => ({ name: f, modified: new Date(mtime).toISOString() })),
    errors,
  };
}

// Muda quando um arquivo é adicionado, removido ou salvo de novo.
export function comercialSignature(dir) {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => `${f}@${fs.statSync(path.join(dir, f)).mtimeMs}`).sort().join(',');
}
