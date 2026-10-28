// Gráficos SVG mínimos (linha e barras horizontais) com tooltip — sem bibliotecas externas.

const NS = 'http://www.w3.org/2000/svg';
const tooltipEl = () => document.getElementById('tooltip');

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  parent?.appendChild(el);
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function showTooltip(html, evt) {
  const tip = tooltipEl();
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > W - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > H - 8) y = evt.clientY - r.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
export const hideTooltip = () => (tooltipEl().hidden = true);

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks.at(-1) < max) ticks.push(+(ticks.at(-1) + step).toFixed(10));
  return ticks;
}

function truncate(text, maxPx, charPx = 6.3) {
  const max = Math.floor(maxPx / charPx);
  return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
}

function legendHtml(items) {
  return `<div class="legend">${items.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// Redesenha ao redimensionar o contêiner.
const observers = new WeakMap();
function onResize(el, draw) {
  observers.get(el)?.disconnect();
  let w = el.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - w) > 4) {
      w = el.clientWidth;
      draw();
    }
  });
  ro.observe(el);
  observers.set(el, ro);
}

// ------------------------------------------------------------------ linha

/**
 * series: [{ name, color, points: [{ x: ms, y: number|null }] }]
 * opts: { yFormat, xTick(ms, spanDays), tooltipTitle(ms), height, endLabels, emptyText }
 */
export function lineChart(el, series, opts = {}) {
  const draw = () => {
    el.innerHTML = '';
    const pts = series.flatMap((s) => s.points.filter((p) => p.y != null));
    if (!pts.length) {
      el.innerHTML = `<div class="empty">${esc(opts.emptyText ?? 'Sem dados para o filtro selecionado')}</div>`;
      return;
    }
    if (series.length > 1) el.insertAdjacentHTML('beforeend', legendHtml(series));

    const W = Math.max(280, el.clientWidth);
    const H = opts.height ?? 300;
    const endLabels = opts.endLabels !== false && series.length <= 5 && W > 480;
    const m = { l: 44, r: endLabels ? 84 : 14, t: 10, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const yFmt = opts.yFormat ?? ((v) => v.toLocaleString('pt-BR'));

    const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
    const x0 = xs[0];
    const x1 = xs.at(-1) === x0 ? x0 + 1 : xs.at(-1);
    const ticks = niceTicks(Math.max(...pts.map((p) => p.y)));
    const yMax = ticks.at(-1);
    const sx = (x) => m.l + ((x - x0) / (x1 - x0)) * iw;
    const sy = (y) => m.t + ih - (y / yMax) * ih;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, el);
    for (const t of ticks) {
      svgEl('line', { x1: m.l, x2: m.l + iw, y1: sy(t), y2: sy(t), class: t === 0 ? 'baseline' : 'grid-line' }, svg);
      svgEl('text', { x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, svg).textContent = yFmt(t);
    }
    // Rótulos do eixo X: ~1 a cada 110px.
    const nX = Math.max(2, Math.floor(iw / 110));
    const spanDays = (x1 - x0) / 864e5;
    const seen = new Set();
    for (let i = 0; i < nX; i++) {
      const x = xs[Math.round((i / (nX - 1)) * (xs.length - 1))];
      const label = (opts.xTick ?? ((v) => new Date(v).toLocaleDateString('pt-BR')))(x, spanDays);
      if (seen.has(label)) continue;
      seen.add(label);
      const anchor = i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle';
      svgEl('text', { x: sx(x), y: H - 6, 'text-anchor': anchor, class: 'axis-label' }, svg).textContent = label;
    }

    const sparse = xs.length <= 30;
    for (const s of series) {
      let d = '';
      let pen = false;
      for (const p of s.points) {
        if (p.y == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
        pen = true;
      }
      svgEl('path', { d, class: 'series-line', stroke: s.color }, svg);
      // Marcadores quando há poucos pontos, e sempre em pontos isolados (sem vizinhos para formar linha).
      s.points.forEach((p, i) => {
        const isolated = s.points[i - 1]?.y == null && s.points[i + 1]?.y == null;
        if (p.y != null && (sparse || isolated)) {
          svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
        }
      });
    }

    if (endLabels) {
      const labels = series
        .map((s) => ({ s, p: s.points.filter((p) => p.y != null).at(-1) }))
        .filter((l) => l.p)
        .map((l) => ({ ...l, y: sy(l.p.y) }))
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
      for (const l of labels) {
        svgEl('text', { x: m.l + iw + 8, y: l.y + 4, class: 'end-label' }, svg).textContent =
          `${truncate(l.s.name, 52)} ${yFmt(l.p.y)}`;
      }
    }

    // Camada de hover: crosshair + tooltip com todas as séries no ponto mais próximo.
    const hover = svgEl('g', { 'pointer-events': 'none', visibility: 'hidden' }, svg);
    const cross = svgEl('line', { y1: m.t, y2: m.t + ih, class: 'crosshair' }, hover);
    const dots = series.map((s) => svgEl('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, hover));
    const overlay = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
    overlay.addEventListener('mousemove', (evt) => {
      const rect = svg.getBoundingClientRect();
      const mx = ((evt.clientX - rect.left) / rect.width) * W;
      const target = x0 + ((mx - m.l) / iw) * (x1 - x0);
      const x = xs.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), xs[0]);
      hover.setAttribute('visibility', 'visible');
      cross.setAttribute('x1', sx(x));
      cross.setAttribute('x2', sx(x));
      const rows = series.map((s, i) => {
        const p = s.points.find((q) => q.x === x);
        if (p?.y != null) {
          dots[i].setAttribute('cx', sx(x));
          dots[i].setAttribute('cy', sy(p.y));
          dots[i].setAttribute('visibility', 'visible');
        } else dots[i].setAttribute('visibility', 'hidden');
        return { s, p };
      }).filter((r) => r.p?.y != null).sort((a, b) => b.p.y - a.p.y);
      const title = (opts.tooltipTitle ?? ((v) => new Date(v).toLocaleDateString('pt-BR')))(x);
      showTooltip(
        `<div class="t-title">${esc(title)}</div>` +
          rows.map((r) => `<div class="t-row"><span><i style="background:${r.s.color}"></i>${esc(r.s.name)}</span><b>${esc(yFmt(r.p.y))}</b></div>` +
            (r.p.note ? `<div class="hint">${esc(r.p.note)}</div>` : '')).join(''),
        evt,
      );
    });
    overlay.addEventListener('mouseleave', () => {
      hover.setAttribute('visibility', 'hidden');
      hideTooltip();
    });
  };
  draw();
  onResize(el, draw);
}

// ------------------------------------------------------------------ barras horizontais

/**
 * items: [{ label, segments: [{ name, value, color }], tooltip: html, onClick }]
 * opts: { valueFormat, legend: [{ name, color }], labelWidth }
 */
export function barChart(el, items, opts = {}) {
  const draw = () => {
    el.innerHTML = '';
    if (!items.length) {
      el.innerHTML = '<div class="empty">Sem dados para o filtro selecionado</div>';
      return;
    }
    if (opts.legend?.length > 1) el.insertAdjacentHTML('beforeend', legendHtml(opts.legend));
    const W = Math.max(280, el.clientWidth);
    const rowH = 26;
    const barH = 16;
    const labelW = Math.min(opts.labelWidth ?? 260, W * 0.45);
    const valueW = 64;
    const H = items.length * rowH + 4;
    const iw = W - labelW - valueW;
    const fmt = opts.valueFormat ?? ((v) => v.toLocaleString('pt-BR'));
    const max = Math.max(...items.map((it) => it.segments.reduce((a, s) => a + (s.value ?? 0), 0))) || 1;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, el);
    items.forEach((it, i) => {
      const y = i * rowH;
      const g = svgEl('g', { class: 'row' }, svg);
      svgEl('rect', { x: 0, y, width: W, height: rowH, rx: 4, class: 'bar-row-bg', fill: 'transparent' }, g);
      svgEl('text', { x: 0, y: y + rowH / 2 + 4, class: 'bar-label' }, g).textContent = truncate(it.label, labelW - 10);
      let x = labelW;
      const segs = it.segments.filter((s) => s.value > 0);
      segs.forEach((s, j) => {
        const w = Math.max(1, (s.value / max) * iw - (j < segs.length - 1 ? 2 : 0));
        const r = j === segs.length - 1 ? Math.min(4, w) : 0;
        const by = y + (rowH - barH) / 2;
        // Extremidade arredondada só no fim da barra; base reta junto ao eixo.
        const d = `M${x},${by}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${barH - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
        svgEl('path', { d, fill: s.color }, g);
        x += w + 2;
      });
      const total = it.segments.reduce((a, s) => a + (s.value ?? 0), 0);
      svgEl('text', { x: x + 4, y: y + rowH / 2 + 4, class: 'bar-value' }, g).textContent = fmt(total);
      const hit = svgEl('rect', { x: 0, y, width: W, height: rowH, class: 'hit' }, g);
      if (it.tooltip) {
        hit.addEventListener('mousemove', (evt) => showTooltip(it.tooltip, evt));
        hit.addEventListener('mouseleave', hideTooltip);
      }
      if (it.onClick) hit.addEventListener('click', it.onClick);
    });
    svgEl('line', { x1: labelW, x2: labelW, y1: 0, y2: H, class: 'baseline' }, svg);
  };
  draw();
  onResize(el, draw);
}

// ------------------------------------------------------------------ dispersão

/**
 * points: [{ x, y, color, tooltip: html, onClick, selected }]
 * opts: { xFormat, yFormat, xLabel, yLabel, legend: [{ name, color }], ref: { slope, label }, height }
 * ref desenha a reta y = slope·x (ex.: custo por ponto mediano): pontos abaixo dela custam menos por ponto.
 */
export function scatterChart(el, points, opts = {}) {
  const draw = () => {
    el.innerHTML = '';
    if (!points.length) {
      el.innerHTML = '<div class="empty">Sem dados para o filtro selecionado</div>';
      return;
    }
    if (opts.legend?.length > 1) el.insertAdjacentHTML('beforeend', legendHtml(opts.legend));
    const W = Math.max(280, el.clientWidth);
    const H = opts.height ?? 320;
    const m = { l: 58, r: 16, t: 12, b: 40 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const xFmt = opts.xFormat ?? ((v) => v.toLocaleString('pt-BR'));
    const yFmt = opts.yFormat ?? ((v) => v.toLocaleString('pt-BR'));
    const xt = niceTicks(Math.max(...points.map((p) => p.x)), Math.max(3, Math.floor(iw / 90)));
    const yt = niceTicks(Math.max(...points.map((p) => p.y)));
    const sx = (x) => m.l + (x / xt.at(-1)) * iw;
    const sy = (y) => m.t + ih - (y / yt.at(-1)) * ih;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, el);
    for (const t of yt) {
      svgEl('line', { x1: m.l, x2: m.l + iw, y1: sy(t), y2: sy(t), class: t === 0 ? 'baseline' : 'grid-line' }, svg);
      svgEl('text', { x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, svg).textContent = yFmt(t);
    }
    for (const t of xt) {
      svgEl('text', { x: sx(t), y: m.t + ih + 16, 'text-anchor': 'middle', class: 'axis-label' }, svg).textContent = xFmt(t);
    }
    if (opts.xLabel) svgEl('text', { x: m.l + iw, y: H - 4, 'text-anchor': 'end', class: 'axis-label' }, svg).textContent = opts.xLabel;
    if (opts.yLabel) svgEl('text', { x: m.l, y: m.t - 2, class: 'axis-label' }, svg).textContent = opts.yLabel;

    if (opts.ref?.slope > 0) {
      // Recorta a reta no limite do gráfico (o que vier primeiro: topo ou lado direito).
      const xEnd = Math.min(xt.at(-1), yt.at(-1) / opts.ref.slope);
      svgEl('line', { x1: sx(0), y1: sy(0), x2: sx(xEnd), y2: sy(xEnd * opts.ref.slope), class: 'ref-line' }, svg);
      const lx = sx(xEnd);
      const ly = sy(xEnd * opts.ref.slope);
      svgEl('text', { x: lx - 4, y: ly + (ly < m.t + 20 ? 14 : -6), 'text-anchor': 'end', class: 'axis-label' }, svg).textContent = opts.ref.label;
    }

    // Selecionados por último, para ficarem por cima.
    for (const p of [...points].sort((a, b) => Number(a.selected) - Number(b.selected))) {
      const g = svgEl('g', {}, svg);
      svgEl('circle', {
        cx: sx(p.x), cy: sy(p.y), r: p.selected ? 7 : 5, fill: p.color,
        stroke: p.selected ? 'var(--text)' : 'var(--surface)', 'stroke-width': 2,
      }, g);
      const hit = svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: 11, class: 'hit' }, g);
      if (p.tooltip) {
        hit.addEventListener('mousemove', (evt) => showTooltip(p.tooltip, evt));
        hit.addEventListener('mouseleave', hideTooltip);
      }
      if (p.onClick) hit.addEventListener('click', p.onClick);
    }
  };
  draw();
  onResize(el, draw);
}
