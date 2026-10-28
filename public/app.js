import { lineChart, barChart, scatterChart, esc } from './charts.js';

// ------------------------------------------------------------------ utilitários

const $ = (sel) => document.querySelector(sel);
const NETWORKS = ['GLOBO', 'RECORD', 'SBT', 'BAND', 'REDE TV!'];
const NETWORK_VAR = { GLOBO: '--net-globo', SBT: '--net-sbt', RECORD: '--net-record', BAND: '--net-band', 'REDE TV!': '--net-redetv' };
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const netColor = (n) => cssVar(NETWORK_VAR[n] ?? '--text-3') || '#888';

const num = (v, d = 1) => (v == null ? '–' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v) => `${num(v, 1)}%`;
const dmy = (iso) => iso.split('-').reverse().join('/');
const dm = (iso) => dmy(iso).slice(0, 5);
const ts = (iso) => Date.UTC(...iso.split('-').map((x, i) => (i === 1 ? x - 1 : +x)));
const monthYear = (iso) => {
  const [y, m] = iso.split('-');
  return `${MONTHS[m - 1]}/${y}`;
};
const xTick = (ms, spanDays) => {
  const d = new Date(ms);
  return spanDays > 500 ? String(d.getUTCFullYear()) : `${MONTHS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
};

function deltaHtml(cur, prev, unit = '') {
  if (cur == null) return '';
  if (prev == null) return '<span class="delta new">novo</span>';
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return '<span class="delta flat">= 0,0</span>';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ −'}${num(Math.abs(d))}${unit}</span>`;
}

const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 8000);
}

// ------------------------------------------------------------------ estado

let data = null;
const ui = {
  tab: store.get('tab', 'tv'),
  tv: { week: null, market: 'PNT', weeks: store.get('tvRange', 52), program: null, networks: new Set(NETWORKS), sort: { col: 'dom', asc: false } },
  radio: { period: null, market: 'GSP', unit: 'OPM', sort: null },
  com: { period: null, network: '', days: '', daypart: '', metric: 'cpp', program: null, sort: { col: 'cpp', asc: true } },
};

// ------------------------------------------------------------------ TV

const tvWeeks = () => data.tv.weeks;
const weekIndex = () => tvWeeks().findIndex((w) => w.end === ui.tv.week);
const progKey = (r) => `${r.network}|${r.program}`;

function top10Avg(week, network, market) {
  const vals = week.rows.filter((r) => r.network === network && r.rank <= 10).map((r) => r.v[market]?.[0]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function prevRowsMap(idx, market) {
  const prev = tvWeeks()[idx - 1];
  return new Map((prev?.rows ?? []).filter((r) => r.v[market]).map((r) => [progKey(r), r.v[market][0]]));
}

function renderTvFilters() {
  const weeks = tvWeeks();
  $('#tv-week').innerHTML = weeks
    .map((w) => `<option value="${w.end}">${dm(w.start)} a ${dmy(w.end)}</option>`)
    .reverse()
    .join('');
  $('#tv-week').value = ui.tv.week;
  const week = weeks[weekIndex()];
  const markets = Object.keys(data.tv.markets).filter((m) => week.rows.some((r) => r.v[m]));
  if (!markets.includes(ui.tv.market)) ui.tv.market = markets[0];
  $('#tv-market').innerHTML = markets.map((m) => `<option value="${m}">${esc(data.tv.markets[m])}</option>`).join('');
  $('#tv-market').value = ui.tv.market;
  $('#tv-source').href = week.link;
}

function renderTv() {
  renderTvFilters();
  const idx = weekIndex();
  const week = tvWeeks()[idx];
  const prev = tvWeeks()[idx - 1];
  const mk = ui.tv.market;
  const mLabel = data.tv.markets[mk];
  const rows = week.rows.filter((r) => r.v[mk]?.[0] != null);
  const prevMap = prevRowsMap(idx, mk);

  // Manchete
  const best = rows.reduce((a, b) => (b.v[mk][0] > (a?.v[mk][0] ?? -1) ? b : a), null);
  $('#tv-headline').innerHTML = best
    ? `Semana de <strong>${dm(week.start)} a ${dmy(week.end)}</strong> (publicada em ${dmy(week.published.slice(0, 10))}) · ` +
      `Programa mais visto em ${esc(mLabel)}: <strong>${esc(best.program)}</strong> (${esc(best.network)}) com <strong>${num(best.v[mk][0])}</strong> pontos`
    : '';

  // KPIs por emissora
  const nets = NETWORKS.filter((n) => rows.some((r) => r.network === n));
  $('#tv-kpis').innerHTML = nets
    .map((n) => {
      const avg = top10Avg(week, n, mk);
      const pAvg = prev ? top10Avg(prev, n, mk) : null;
      const top = rows.filter((r) => r.network === n).sort((a, b) => b.v[mk][0] - a.v[mk][0])[0];
      return `<div class="kpi">
        <div class="label"><span class="swatch" style="background:${netColor(n)}"></span>${esc(n)} · média Top 10</div>
        <div class="value">${num(avg)}<small>pts</small> ${deltaHtml(avg, pAvg)}</div>
        <div class="meta" title="${esc(top?.program)}">#1: ${esc(top?.program ?? '–')} · ${num(top?.v[mk][0])}</div>
      </div>`;
    })
    .join('');

  // Tendência
  const span = ui.tv.weeks ? tvWeeks().slice(Math.max(0, idx - ui.tv.weeks + 1), idx + 1) : tvWeeks().slice(0, idx + 1);
  document.querySelectorAll('#tv-range button').forEach((b) => b.classList.toggle('on', +b.dataset.weeks === ui.tv.weeks));
  lineChart(
    $('#tv-trend'),
    nets.map((n) => ({ name: n, color: netColor(n), points: span.map((w) => ({ x: ts(w.end), y: top10Avg(w, n, mk) })) })),
    {
      yFormat: (v) => num(v),
      xTick,
      tooltipTitle: (x) => {
        const w = span.find((s) => ts(s.end) === x);
        return `Semana ${dm(w.start)} a ${dmy(w.end)} · ${mLabel}`;
      },
    },
  );

  // Top 15 da semana
  const top = [...rows].sort((a, b) => b.v[mk][0] - a.v[mk][0]).slice(0, 15);
  barChart(
    $('#tv-top'),
    top.map((r) => ({
      label: r.program,
      segments: [{ name: r.network, value: r.v[mk][0], color: netColor(r.network) }],
      tooltip: tvRowTooltip(r, mk, prevMap, week),
      onClick: () => selectProgram(progKey(r)),
    })),
    { valueFormat: (v) => num(v), legend: nets.map((n) => ({ name: n, color: netColor(n) })) },
  );

  renderTvTable(rows, prevMap, week);
  renderProgram();
}

function tvRowTooltip(r, mk, prevMap, week) {
  const [dom, ind, cov] = r.v[mk];
  return `<div class="t-title">${esc(r.program)}</div>
    <div class="t-row"><span><i style="background:${netColor(r.network)}"></i>${esc(r.network)}</span><b>#${r.rank} na emissora</b></div>
    <div class="t-row"><span>Audiência domiciliar (Rat%)</span><b>${num(dom)}</b></div>
    <div class="t-row"><span>Audiência individual (${week.units[mk]?.ind === 'Rat#' ? 'mil pessoas' : 'Rat%'})</span><b>${num(ind)}</b></div>
    <div class="t-row"><span>Cobertura individual (${week.units[mk]?.cov})</span><b>${num(cov)}</b></div>
    <div class="t-row"><span>vs. semana anterior</span>${deltaHtml(dom, prevMap.get(progKey(r))) || '–'}</div>`;
}

function renderTvTable(rows, prevMap, week) {
  const { col, asc } = ui.tv.sort;
  const mk = ui.tv.market;
  const indLabel = week.units[mk]?.ind === 'Rat#' ? 'Ind. (mil)' : 'Ind. Rat%';
  const covLabel = week.units[mk]?.cov === 'Cov#' ? 'Cob. (mil)' : 'Cob. %';
  $('#tv-units-hint').textContent =
    `${data.tv.markets[ui.tv.market]} · Rat% = % de domicílios · Ind. = audiência individual · Cob. = alcance acumulado (pessoas diferentes impactadas)`;

  $('#tv-networks').innerHTML = NETWORKS.filter((n) => rows.some((r) => r.network === n))
    .map((n) => `<button class="chip" data-net="${esc(n)}" aria-pressed="${ui.tv.networks.has(n)}"><span class="swatch" style="background:${netColor(n)}"></span>${esc(n)}</button>`)
    .join('');

  const list = rows
    .filter((r) => ui.tv.networks.has(r.network))
    .map((r) => ({ r, dom: r.v[mk][0], ind: r.v[mk][1], cov: r.v[mk][2], delta: prevMap.has(progKey(r)) ? r.v[mk][0] - prevMap.get(progKey(r)) : null }));
  const key = { rank: (x) => x.r.rank, program: (x) => x.r.program, network: (x) => x.r.network, dom: (x) => x.dom, ind: (x) => x.ind, cov: (x) => x.cov, delta: (x) => x.delta ?? -Infinity }[col];
  list.sort((a, b) => {
    const va = key(a), vb = key(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return asc ? c : -c;
  });

  const th = (id, label) => `<th data-col="${id}" class="${col === id ? `sorted${asc ? ' asc' : ''}` : ''}">${label}</th>`;
  $('#tv-table').innerHTML =
    `<thead><tr>${th('rank', '#')}${th('program', 'Programa')}${th('network', 'Emissora')}${th('dom', 'Rat% dom.')}${th('ind', indLabel)}${th('cov', covLabel)}${th('delta', 'Δ semana')}</tr></thead><tbody>` +
    list
      .map(({ r, dom, ind, cov }) => `<tr data-key="${esc(progKey(r))}" class="${progKey(r) === ui.tv.program ? 'sel' : ''}">
        <td>${r.rank}</td><td class="prog">${esc(r.program)}</td>
        <td><span class="net-tag"><i style="background:${netColor(r.network)}"></i>${esc(r.network)}</span></td>
        <td><b>${num(dom)}</b></td><td>${num(ind)}</td><td>${num(cov)}</td>
        <td>${deltaHtml(dom, prevMap.get(progKey(r)))}</td></tr>`)
      .join('') +
    '</tbody>';
}

function programIndex() {
  if (programIndex.cache?.data === data) return programIndex.cache.list;
  const last = new Map();
  for (const w of tvWeeks()) for (const r of w.rows) last.set(progKey(r), w.end);
  const list = [...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([k]) => k);
  programIndex.cache = { data, list };
  return list;
}

function selectProgram(key) {
  ui.tv.program = key;
  $('#tv-program').value = key.replace('|', ' — ');
  renderProgram();
  document.querySelectorAll('#tv-table tbody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.key === key));
}

function renderProgram() {
  const mk = ui.tv.market;
  if (!ui.tv.program) {
    const week = tvWeeks()[weekIndex()];
    const best = week.rows.filter((r) => r.v[mk]?.[0] != null).sort((a, b) => b.v[mk][0] - a.v[mk][0])[0];
    if (!best) return;
    ui.tv.program = progKey(best);
    $('#tv-program').value = ui.tv.program.replace('|', ' — ');
  }
  const [network, program] = ui.tv.program.split('|');
  const weeks = tvWeeks();
  const hits = weeks.map((w) => w.rows.find((r) => r.network === network && r.program === program && r.v[mk]?.[0] != null));
  const first = hits.findIndex(Boolean);
  const lastIdx = hits.findLastIndex(Boolean);
  const points = first < 0 ? [] : weeks.slice(first, lastIdx + 1).map((w, i) => {
    const r = hits[first + i];
    return { x: ts(w.end), y: r?.v[mk][0] ?? null, note: r ? `#${r.rank} na ${network}` : null };
  });
  lineChart($('#tv-program-chart'), [{ name: `${program} (${network})`, color: netColor(network), points }], {
    height: 260,
    endLabels: false,
    yFormat: (v) => num(v),
    xTick,
    emptyText: `Sem dados de ${data.tv.markets[mk]} para este programa`,
    tooltipTitle: (x) => {
      const w = weeks.find((s) => ts(s.end) === x);
      return `Semana ${dm(w.start)} a ${dmy(w.end)}`;
    },
  });
  $('#tv-programs').innerHTML = programIndex().slice(0, 3000).map((k) => `<option value="${esc(k.replace('|', ' — '))}">`).join('');
}

// ------------------------------------------------------------------ Rádio

const periodKey = (r) => `${r.start}|${r.end}`;
const periodLabel = (k) => {
  const [s, e] = k.split('|');
  return `${monthYear(s)} a ${monthYear(e)}`;
};

function radioRows() {
  return data.radio.rows.filter((r) => r.unit === ui.radio.unit);
}

function radioFormat(v) {
  return ui.radio.unit === 'OPM' ? num(v, 0) : num(v, 2);
}

function renderRadio() {
  const rows = radioRows();
  const periods = [...new Set(rows.map(periodKey))].sort((a, b) => a.split('|')[1].localeCompare(b.split('|')[1]) || a.localeCompare(b));
  if (!periods.includes(ui.radio.period)) ui.radio.period = periods.at(-1);
  $('#radio-period').innerHTML = [...periods].reverse().map((p) => `<option value="${p}">${periodLabel(p)}</option>`).join('');
  $('#radio-period').value = ui.radio.period;
  $('#radio-unit').value = ui.radio.unit;

  const inPeriod = rows.filter((r) => periodKey(r) === ui.radio.period);
  const markets = Object.keys(data.radio.markets).filter((m) => rows.some((r) => r.market === m));
  if (!markets.includes(ui.radio.market)) ui.radio.market = markets[0];
  $('#radio-market').innerHTML = markets.map((m) => `<option value="${m}">${esc(data.radio.markets[m])}</option>`).join('');
  $('#radio-market').value = ui.radio.market;

  const unitLabel = ui.radio.unit === 'OPM' ? 'ouvintes por minuto' : 'índice de audiência (%)';
  const plat = [
    { key: 'fm', name: 'FM', color: cssVar('--pl-fm') },
    { key: 'am', name: 'AM', color: cssVar('--pl-am') },
    { key: 'web', name: 'Web', color: cssVar('--pl-web') },
  ];
  const mName = data.radio.markets[ui.radio.market];

  // KPIs da praça selecionada
  const history = rows.filter((r) => r.market === ui.radio.market).sort((a, b) => a.end.localeCompare(b.end));
  const cur = history.find((r) => periodKey(r) === ui.radio.period);
  const prev = cur ? history[history.indexOf(cur) - 1] : null;
  const share = (r, k) => (r ? (r[k] / r.total) * 100 : null);
  const deltaPct = cur && prev ? ((cur.total - prev.total) / prev.total) * 100 : null;
  $('#radio-kpis').innerHTML = cur
    ? `<div class="kpi"><div class="label">${esc(mName)} · total de emissoras</div>
        <div class="value">${radioFormat(cur.total)}</div>
        <div class="meta">${unitLabel} · ${deltaPct == null ? 'sem período anterior' : `${deltaPct >= 0 ? '▲ +' : '▼ −'}${num(Math.abs(deltaPct))}% vs. ${periodLabel(periodKey(prev))}`}</div></div>` +
      plat.map((p) => `<div class="kpi"><div class="label"><span class="swatch" style="background:${p.color}"></span>Participação ${p.name}</div>
        <div class="value">${pct(share(cur, p.key))}</div>
        <div class="meta">${radioFormat(cur[p.key])} ${ui.radio.unit === 'OPM' ? 'OPM' : 'pts'} · ${deltaHtml(share(cur, p.key), share(prev, p.key), ' p.p.') || 'sem período anterior'}</div></div>`).join('')
    : `<div class="kpi"><div class="label">${esc(mName)}</div><div class="meta">Sem dados para este período</div></div>`;

  // Barras por praça
  $('#radio-bars-hint').textContent = `${periodLabel(ui.radio.period)} · ${unitLabel} · FM + AM + Web = total de emissoras`;
  barChart(
    $('#radio-bars'),
    [...inPeriod].sort((a, b) => b.total - a.total).map((r) => ({
      label: data.radio.markets[r.market] ?? r.market,
      segments: plat.map((p) => ({ name: p.name, value: r[p.key], color: p.color })),
      tooltip: `<div class="t-title">${esc(data.radio.markets[r.market])}</div>` +
        plat.map((p) => `<div class="t-row"><span><i style="background:${p.color}"></i>${p.name}</span><b>${radioFormat(r[p.key])} · ${pct(share(r, p.key))}</b></div>`).join('') +
        `<div class="t-row"><span>Total de emissoras</span><b>${radioFormat(r.total)}</b></div>`,
      onClick: () => { ui.radio.market = r.market; renderRadio(); },
    })),
    { valueFormat: radioFormat, legend: plat, labelWidth: 170 },
  );

  // Evolução da praça
  $('#radio-trend-title').textContent = `Evolução · ${mName}`;
  $('#radio-trend-hint').textContent = `${unitLabel} por plataforma, em cada período publicado`;
  lineChart(
    $('#radio-trend'),
    plat.map((p) => ({ name: p.name, color: p.color, points: history.map((r) => ({ x: ts(`${r.end}-01`), y: r[p.key] })) })),
    {
      yFormat: (v) => (ui.radio.unit === 'OPM' && v >= 1000 ? `${num(v / 1000, 0)} mil` : radioFormat(v)),
      xTick,
      tooltipTitle: (x) => {
        const r = history.find((h) => ts(`${h.end}-01`) === x);
        return `${periodLabel(periodKey(r))} · total ${radioFormat(r.total)}`;
      },
    },
  );

  // Tabela
  $('#radio-table-title').textContent = `Histórico · ${mName}`;
  $('#radio-table').innerHTML =
    '<thead><tr><th>Período</th><th>Publicado</th><th></th><th>Total emissoras</th><th>Total rádio</th><th>FM</th><th>AM</th><th>Web</th></tr></thead><tbody>' +
    [...history].reverse().map((r) => `<tr class="${periodKey(r) === ui.radio.period ? 'sel' : ''}" data-period="${periodKey(r)}">
      <td>${periodLabel(periodKey(r))}</td><td>${dmy(r.published.slice(0, 10))}</td><td><a href="${esc(r.link)}" target="_blank" rel="noopener">post ↗</a></td>
      <td><b>${radioFormat(r.total)}</b></td><td>${radioFormat(r.radio)}</td><td>${radioFormat(r.fm)}</td><td>${radioFormat(r.am)}</td><td>${radioFormat(r.web)}</td></tr>`).join('') +
    '</tbody>';
}


// ------------------------------------------------------------------ Comercial (planilhas)

const COM_NETWORKS = ['SBT', 'RECORD'];
const NO_PERIOD = 'sem-mes';
const hasComercial = () => Boolean(data?.comercial?.rows?.length);
const comKey = (r) => `${r.network}|${r.key}`;
const brl = (v) => (v == null ? '–' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const brlAxis = (v) => (v >= 1000 ? `R$ ${num(v / 1000, v % 1000 ? 1 : 0)} mil` : `R$ ${num(v, 0)}`);
const comPeriods = () => data.comercial.periods;
const comDated = () => comPeriods().filter((p) => p.key !== NO_PERIOD);
const comLabel = (key) => comPeriods().find((p) => p.key === key)?.label ?? key;

function comPrev(key) {
  const dated = comDated();
  const i = dated.findIndex((p) => p.key === key);
  return i > 0 ? dated[i - 1].key : null;
}

// Linhas do mês com os filtros de dias e faixa; `network` restringe a uma emissora.
function comRows(period, network = ui.com.network) {
  return data.comercial.rows.filter((r) =>
    r.period === period &&
    (!network || r.network === network) &&
    (!ui.com.days || r.diaGrupo === ui.com.days) &&
    (!ui.com.daypart || r.faixa === ui.com.daypart));
}

// Custo por ponto da grade: soma dos valores ÷ soma dos pontos (programas com os dois valores).
function gridStats(rows) {
  const ok = rows.filter((r) => r.valor != null && r.pontos);
  if (!ok.length) return { cpp: null, pontos: null, n: rows.length };
  const valor = ok.reduce((a, r) => a + r.valor, 0);
  const pontos = ok.reduce((a, r) => a + r.pontos, 0);
  return { cpp: valor / pontos, pontos: pontos / ok.length, n: rows.length };
}

// Para custo, subir é ruim; para audiência, subir é bom.
function pctDelta(cur, prev, higherIsBetter) {
  if (cur == null || prev == null || !prev) return '';
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.05) return '<span class="delta flat">= 0,0%</span>';
  const good = d > 0 === higherIsBetter;
  return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ −'}${num(Math.abs(d))}%</span>`;
}

function comTooltip(r) {
  return `<div class="t-title">${esc(r.programa)}</div>
    <div class="t-row"><span><i style="background:${netColor(r.network)}"></i>${esc(r.network)}</span><b>${esc(r.dia)} · ${esc(r.hora ?? '')}</b></div>
    <div class="t-row"><span>Pontos de audiência</span><b>${num(r.pontos, 2)}</b></div>
    <div class="t-row"><span>Valor unitário</span><b>${brl(r.valor)}</b></div>
    <div class="t-row"><span>Custo por ponto</span><b>${brl(r.cpp)}</b></div>
    <div class="t-row"><span>Preço de tabela (SP1)</span><b>${brl(r.preco)}</b></div>` +
    (r.ibope ? `<div class="t-row"><span>IBOPE GSP (média de ${r.ibope.semanas} sem.)</span><b>${num(r.ibope.gsp, 2)}</b></div>` : '');
}

function selectComProgram(key) {
  ui.com.program = key;
  renderComercial();
}

function renderComercial() {
  const c = data.comercial;
  if (!comPeriods().some((p) => p.key === ui.com.period)) ui.com.period = comDated().at(-1)?.key ?? comPeriods()[0].key;
  $('#com-period').innerHTML = [...comDated()].reverse().concat(comPeriods().filter((p) => p.key === NO_PERIOD))
    .map((p) => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  $('#com-period').value = ui.com.period;
  $('#com-network').value = ui.com.network;
  $('#com-days').value = ui.com.days;
  $('#com-daypart').value = ui.com.daypart;

  const period = ui.com.period;
  const prev = comPrev(period);
  const rows = comRows(period);
  const priced = rows.filter((r) => r.cpp != null);
  const missing = rows.length - priced.length;
  const nets = ui.com.network ? [ui.com.network] : COM_NETWORKS;

  $('#com-headline').innerHTML =
    `Grade comercial de <strong>São Paulo (SP1)</strong> · <strong>${esc(comLabel(period))}</strong> · ${rows.length} programas` +
    (missing ? ` · ${missing} sem pontos de audiência, fora do custo por ponto` : '') +
    ` · fonte: ${c.files.map((f) => esc(f.name)).join(', ')}`;

  // KPIs
  const best = [...priced].sort((a, b) => a.cpp - b.cpp)[0];
  const top = [...priced].sort((a, b) => b.pontos - a.pontos)[0];
  $('#com-kpis').innerHTML =
    nets.map((n) => {
      const cur = gridStats(comRows(period, n));
      const before = prev ? gridStats(comRows(prev, n)) : null;
      return `<div class="kpi">
        <div class="label"><span class="swatch" style="background:${netColor(n)}"></span>${n} · custo por ponto da grade</div>
        <div class="value">${brl(cur.cpp)} ${pctDelta(cur.cpp, before?.cpp, false)}</div>
        <div class="meta">${prev ? `vs. ${esc(comLabel(prev))} · ` : ''}média de ${num(cur.pontos, 2)} pontos · ${cur.n} programas</div>
      </div>`;
    }).join('') +
    (best ? `<div class="kpi"><div class="label"><span class="swatch" style="background:${netColor(best.network)}"></span>Menor custo por ponto</div>
      <div class="value">${brl(best.cpp)}</div><div class="meta" title="${esc(best.programa)}">${esc(best.programa)} · ${esc(best.network)} · ${num(best.pontos, 2)} pts</div></div>` : '') +
    (top ? `<div class="kpi"><div class="label"><span class="swatch" style="background:${netColor(top.network)}"></span>Maior audiência</div>
      <div class="value">${num(top.pontos, 2)}<small>pts</small></div><div class="meta" title="${esc(top.programa)}">${esc(top.programa)} · ${esc(top.network)} · ${brl(top.cpp)}/ponto</div></div>` : '');

  // Dispersão preço × audiência
  const cpps = priced.map((r) => r.cpp).sort((a, b) => a - b);
  const median = cpps.length ? cpps[Math.floor(cpps.length / 2)] : null;
  scatterChart(
    $('#com-scatter'),
    priced.map((r) => ({
      x: r.pontos, y: r.valor, color: netColor(r.network), selected: comKey(r) === ui.com.program,
      tooltip: comTooltip(r), onClick: () => selectComProgram(comKey(r)),
    })),
    {
      xFormat: (v) => num(v, v % 1 ? 1 : 0),
      yFormat: brlAxis,
      xLabel: 'pontos de audiência →',
      yLabel: 'valor unitário',
      legend: nets.map((n) => ({ name: n, color: netColor(n) })),
      ref: median ? { slope: median, label: `mediana ${brl(median)}/ponto` } : null,
    },
  );

  // Evolução mensal
  const metric = ui.com.metric;
  document.querySelectorAll('#com-metric button').forEach((b) => b.classList.toggle('on', b.dataset.metric === metric));
  $('#com-trend-hint').textContent = metric === 'cpp'
    ? 'Custo por ponto da grade (soma dos valores ÷ soma dos pontos), com os filtros de dias e faixa'
    : 'Média dos pontos de audiência dos programas da grade, com os filtros de dias e faixa';
  lineChart(
    $('#com-trend'),
    nets.map((n) => ({
      name: n, color: netColor(n),
      points: comDated().map((p) => ({ x: ts(`${p.key}-01`), y: gridStats(comRows(p.key, n))[metric] })),
    })),
    {
      height: 280,
      yFormat: metric === 'cpp' ? brlAxis : (v) => num(v, 1),
      xTick: (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`; },
      tooltipTitle: (x) => comLabel(new Date(x).toISOString().slice(0, 7)),
    },
  );

  // 15 menores custos por ponto
  barChart(
    $('#com-bars'),
    [...priced].sort((a, b) => a.cpp - b.cpp).slice(0, 15).map((r) => ({
      label: r.programa,
      segments: [{ name: r.network, value: r.cpp, color: netColor(r.network) }],
      tooltip: comTooltip(r),
      onClick: () => selectComProgram(comKey(r)),
    })),
    { valueFormat: brl, legend: nets.map((n) => ({ name: n, color: netColor(n) })) },
  );

  renderComProgram(rows);
  renderComTable(rows, prev);
}

function renderComProgram(rows) {
  if (!ui.com.program || !data.comercial.rows.some((r) => comKey(r) === ui.com.program)) {
    // Padrão: entre os programas presentes em mais meses, o de maior audiência.
    const months = new Map();
    for (const r of data.comercial.rows) if (r.period !== NO_PERIOD) months.set(comKey(r), (months.get(comKey(r)) ?? 0) + 1);
    const top = [...rows].filter((r) => r.pontos != null)
      .sort((a, b) => (months.get(comKey(b)) ?? 0) - (months.get(comKey(a)) ?? 0) || b.pontos - a.pontos)[0];
    ui.com.program = top ? comKey(top) : null;
  }
  if (!ui.com.program) return;
  const hist = data.comercial.rows.filter((r) => comKey(r) === ui.com.program);
  const sample = hist.at(-1);
  $('#com-program-title').textContent = `Histórico · ${sample.programa} (${sample.network})`;
  const at = (p) => hist.find((r) => r.period === p.key);
  lineChart(
    $('#com-program-chart'),
    [
      { name: 'Planilha (pontos)', color: netColor(sample.network), points: comDated().map((p) => ({ x: ts(`${p.key}-01`), y: at(p)?.pontos ?? null })) },
      { name: 'IBOPE GSP (Rat% dom.)', color: cssVar('--text-3'), points: comDated().map((p) => ({ x: ts(`${p.key}-01`), y: at(p)?.ibope?.gsp ?? null })) },
    ],
    {
      height: 240,
      endLabels: false,
      yFormat: (v) => num(v, 1),
      xTick: (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`; },
      tooltipTitle: (x) => {
        const key = new Date(x).toISOString().slice(0, 7);
        const r = hist.find((h) => h.period === key);
        return `${comLabel(key)}${r?.cpp != null ? ` · ${brl(r.cpp)}/ponto` : ''}`;
      },
    },
  );
  const dated = hist.filter((r) => r.period !== NO_PERIOD && r.cpp != null);
  const first = dated[0];
  const last = dated.at(-1);
  $('#com-program-note').innerHTML = first && last && first !== last
    ? `Custo por ponto: <strong>${brl(first.cpp)}</strong> em ${esc(comLabel(first.period))} → <strong>${brl(last.cpp)}</strong> em ${esc(comLabel(last.period))} · preço de tabela atual ${brl(last.preco)}`
    : last ? `Custo por ponto em ${esc(comLabel(last.period))}: <strong>${brl(last.cpp)}</strong>` : '';
}

function renderComTable(rows, prev) {
  const prevMap = new Map((prev ? comRows(prev) : []).map((r) => [comKey(r), r.pontos]));
  $('#com-table-hint').textContent =
    'Preço de tabela = coluna “SÃO PAULO (SP1)” · Valor unitário = coluna “Valor Unitario” · Custo por ponto = valor unitário ÷ pontos' +
    (prev ? ` · Δ pontos vs. ${comLabel(prev)}` : '');
  const { col, asc } = ui.com.sort;
  const list = rows.map((r) => ({ r, delta: r.pontos != null && prevMap.get(comKey(r)) != null ? r.pontos - prevMap.get(comKey(r)) : null }));
  const key = {
    dia: (x) => x.r.dia, hora: (x) => x.r.minutos ?? -1, programa: (x) => x.r.programa, network: (x) => x.r.network, faixa: (x) => x.r.faixa ?? '',
    preco: (x) => x.r.preco ?? -1, valor: (x) => x.r.valor ?? -1, pontos: (x) => x.r.pontos ?? -1, ibope: (x) => x.r.ibope?.gsp ?? -1,
    cpp: (x) => x.r.cpp ?? Infinity, delta: (x) => x.delta ?? -Infinity,
  }[col];
  list.sort((a, b) => {
    const va = key(a), vb = key(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return asc ? c : -c;
  });
  const th = (id, label, cls = '') => `<th data-col="${id}" class="${cls} ${col === id ? `sorted${asc ? ' asc' : ''}` : ''}">${label}</th>`;
  $('#com-table').innerHTML =
    `<thead><tr>${th('dia', 'Dia')}${th('hora', 'Hora')}${th('programa', 'Programa')}${th('network', 'Emissora', 'l')}${th('faixa', 'Faixa', 'l')}` +
    `${th('preco', 'Preço tabela')}${th('valor', 'Valor unit.')}${th('pontos', 'Pontos')}${th('ibope', 'IBOPE GSP')}${th('cpp', 'Custo/ponto')}${th('delta', 'Δ pontos')}</tr></thead><tbody>` +
    list.map(({ r, delta }) => `<tr data-key="${esc(comKey(r))}" class="${comKey(r) === ui.com.program ? 'sel' : ''}">
      <td>${esc(r.dia)}</td><td>${esc(r.hora ?? '–')}</td><td class="prog">${esc(r.programa)}</td>
      <td class="l"><span class="net-tag"><i style="background:${netColor(r.network)}"></i>${esc(r.network)}</span></td><td class="l">${esc(r.faixa ?? '–')}</td>
      <td>${brl(r.preco)}</td><td>${brl(r.valor)}</td><td><b>${num(r.pontos, 2)}</b></td>
      <td>${r.ibope ? num(r.ibope.gsp, 2) : '–'}</td><td><b>${brl(r.cpp)}</b></td>
      <td>${delta == null ? '' : `<span class="delta ${delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat'}">${delta > 0.005 ? '▲ +' : delta < -0.005 ? '▼ −' : '= '}${num(Math.abs(delta), 2)}</span>`}</td></tr>`).join('') +
    '</tbody>';
}

// ------------------------------------------------------------------ sincronização

let lastStatus = null;

// No GitHub Pages os dados vêm de arquivos estáticos (gerados por scripts/build-site.js);
// localmente, da API do servidor.
const STATIC_DATA = document.querySelector('meta[name="static-data"]')?.content;
const fresh = (url) => `${url}?v=${Date.now()}`;
const DATA_URL = () => (STATIC_DATA ? fresh(STATIC_DATA) : '/api/data');
const STATUS_URL = () => (STATIC_DATA ? fresh('status.json') : '/api/status');
const POLL_MS = STATIC_DATA ? 10 * 60000 : 30000;

function renderStatus(s) {
  const el = $('#sync-status');
  const time = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  el.className = 'sync-status';
  if (s.static) {
    // O GitHub Actions verifica o site várias vezes por dia; dois dias sem verificação indicam falha.
    const stale = Date.now() - Date.parse(s.lastCheck) > 2 * 864e5;
    if (stale) el.classList.add('err');
    el.innerHTML = `<span class="dot"></span>${stale ? 'Sem atualização desde' : 'Atualização automática · verificado'} ${time(s.lastCheck)}`;
  } else if (s.syncing) {
    el.classList.add('busy');
    el.innerHTML = `<span class="dot"></span>Verificando novas postagens… ${esc(s.progress ?? '')}`;
  } else if (s.lastError && (!s.lastCheck || s.lastError.at >= s.lastCheck)) {
    el.classList.add('err');
    el.innerHTML = `<span class="dot"></span>Falha ao verificar (${esc(s.lastError.message)}) · usando dados salvos`;
  } else {
    const next = s.lastCheck ? new Date(Date.parse(s.lastCheck) + s.intervalMin * 60000) : null;
    el.innerHTML = `<span class="dot"></span>Verificado ${s.lastCheck ? time(s.lastCheck) : '—'}` +
      (next ? ` · próxima ~${next.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '');
  }
  $('#sync-btn').disabled = s.syncing;
}

async function loadData() {
  const res = await fetch(DATA_URL());
  const next = await res.json();
  const before = data;
  data = next;
  const latest = tvWeeks().at(-1);
  if (!ui.tv.week || (before && ui.tv.week === before.tv.weeks.at(-1)?.end)) ui.tv.week = latest.end;
  if (before) {
    const newWeeks = tvWeeks().filter((w) => !before.tv.weeks.some((b) => b.end === w.end));
    const newRadio = data.radio.rows.length - before.radio.rows.length;
    const sheetsChanged = JSON.stringify(before.comercial?.files ?? []) !== JSON.stringify(data.comercial?.files ?? []);
    if (newWeeks.length) toast(`Nova semana publicada: ${dm(newWeeks.at(-1).start)} a ${dmy(newWeeks.at(-1).end)}`);
    else if (newRadio > 0) toast('Novos dados de rádio publicados');
    else if (sheetsChanged) toast('Planilha comercial atualizada');
    else toast('Dados atualizados');
  }
  render();
  lastStatus = data.meta;
  renderStatus(data.meta);
}

let pollTimer;
let manualSync = false;
const schedulePoll = (ms) => {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollStatus, ms);
};

async function pollStatus() {
  try {
    const s = await (await fetch(STATUS_URL())).json();
    renderStatus(s);
    const changed = lastStatus && s.version !== lastStatus.version;
    lastStatus = s;
    if (changed) await loadData();
    else if (manualSync && !s.syncing && !s.lastError) toast('Nenhuma postagem nova encontrada');
    if (!s.syncing) manualSync = false;
    schedulePoll(s.syncing ? 2000 : POLL_MS);
  } catch {
    $('#sync-status').className = 'sync-status err';
    $('#sync-status').innerHTML = STATIC_DATA
      ? '<span class="dot"></span>Sem conexão · tentando de novo'
      : '<span class="dot"></span>Servidor local parado — rode <code>npm start</code>';
    schedulePoll(STATIC_DATA ? 60000 : 10000);
  }
}

// ------------------------------------------------------------------ eventos

function render() {
  // A aba Comercial só aparece quando há planilhas (no site público ela fica de fora).
  $('[data-tab="comercial"]').hidden = !hasComercial();
  if (ui.tab === 'comercial' && !hasComercial()) ui.tab = 'tv';
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === ui.tab));
  for (const t of ['tv', 'radio', 'comercial']) $(`#tab-${t}`).hidden = ui.tab !== t;
  if (ui.tab === 'tv') renderTv();
  else if (ui.tab === 'radio') renderRadio();
  else renderComercial();
}

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => { ui.tab = b.dataset.tab; store.set('tab', ui.tab); render(); }));

$('#tv-week').addEventListener('change', (e) => { ui.tv.week = e.target.value; renderTv(); });
$('#tv-market').addEventListener('change', (e) => { ui.tv.market = e.target.value; renderTv(); });
$('#tv-range').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  ui.tv.weeks = +b.dataset.weeks;
  store.set('tvRange', ui.tv.weeks);
  renderTv();
});
$('#tv-networks').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const n = b.dataset.net;
  const s = ui.tv.networks;
  // Clicar com todas ativas isola a emissora; clicar na única ativa reativa todas.
  if (s.size === NETWORKS.length) { s.clear(); s.add(n); } else if (s.has(n) && s.size === 1) NETWORKS.forEach((x) => s.add(x));
  else s.has(n) ? s.delete(n) : s.add(n);
  renderTv();
});
$('#tv-table').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (th) {
    const col = th.dataset.col;
    ui.tv.sort = { col, asc: ui.tv.sort.col === col ? !ui.tv.sort.asc : ['rank', 'program', 'network'].includes(col) };
    return renderTv();
  }
  const tr = e.target.closest('tbody tr');
  if (tr) selectProgram(tr.dataset.key);
});
$('#tv-program').addEventListener('change', (e) => {
  const key = e.target.value.replace(' — ', '|');
  const [network, program] = key.split('|');
  if (programIndex().includes(key)) return selectProgram(key);
  // Busca aproximada pelo nome do programa
  const q = (program ?? network).trim().toUpperCase();
  const found = programIndex().find((k) => k.split('|')[1].includes(q));
  if (found) selectProgram(found);
});

$('#radio-period').addEventListener('change', (e) => { ui.radio.period = e.target.value; renderRadio(); });
$('#radio-market').addEventListener('change', (e) => { ui.radio.market = e.target.value; renderRadio(); });
$('#radio-unit').addEventListener('change', (e) => { ui.radio.unit = e.target.value; ui.radio.period = null; renderRadio(); });
$('#radio-table').addEventListener('click', (e) => {
  const tr = e.target.closest('tbody tr');
  if (tr && !e.target.closest('a')) { ui.radio.period = tr.dataset.period; renderRadio(); }
});

for (const [id, field] of [['#com-period', 'period'], ['#com-network', 'network'], ['#com-days', 'days'], ['#com-daypart', 'daypart']]) {
  $(id).addEventListener('change', (e) => { ui.com[field] = e.target.value; renderComercial(); });
}
$('#com-metric').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) { ui.com.metric = b.dataset.metric; renderComercial(); }
});
$('#com-table').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (th) {
    const col = th.dataset.col;
    ui.com.sort = { col, asc: ui.com.sort.col === col ? !ui.com.sort.asc : ['dia', 'hora', 'programa', 'network', 'faixa', 'cpp'].includes(col) };
    return renderComercial();
  }
  const tr = e.target.closest('tbody tr');
  if (tr) selectComProgram(tr.dataset.key);
});

$('#sync-btn').hidden = Boolean(STATIC_DATA);
$('#sync-btn').addEventListener('click', async () => {
  $('#sync-btn').disabled = true;
  manualSync = true;
  await fetch('/api/sync', { method: 'POST' });
  renderStatus({ ...lastStatus, syncing: true, progress: '' });
  schedulePoll(1500);
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => data && render());

loadData().then(() => schedulePoll(lastStatus?.syncing ? 2000 : POLL_MS));
