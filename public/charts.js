// Graphiques SVG faits main (pas de dépendance, fonctionne hors ligne).
// Règles : un seul axe Y, traits fins, légende dès 2 séries, info-bulle au survol,
// tableau de données accessible sous chaque graphique.

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const fmt = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }));
const shortDate = (iso) => { const [, m, d] = iso.split("-"); return `${+d}/${+m}`; };

let tip;
function tooltip() {
  if (!tip) { tip = document.createElement("div"); tip.className = "tip"; document.body.appendChild(tip); }
  return tip;
}
function showTip(evt, html) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = "block";
  const x = (evt.touches ? evt.touches[0].clientX : evt.clientX);
  const y = (evt.touches ? evt.touches[0].clientY : evt.clientY);
  const w = t.offsetWidth;
  t.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + "px";
  t.style.top = (y - t.offsetHeight - 14) + "px";
}
const hideTip = () => { if (tip) tip.style.display = "none"; };
document.addEventListener("scroll", hideTip, { passive: true });

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= count) || step0 * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function legend(container, series) {
  if (series.length < 2) return;
  const l = document.createElement("div");
  l.className = "legend";
  l.innerHTML = series.map((s) => `<span><i style="background:${s.color}${s.dash ? ";height:2px;border-top:2px dashed " + s.color + ";background:none" : ""}"></i>${s.name}</span>`).join("");
  container.prepend(l);
}

function dataTable(container, headers, rows) {
  const d = document.createElement("details");
  d.className = "datatable";
  d.innerHTML = `<summary>Voir les données</summary><div class="scroll"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  container.appendChild(d);
}

// Courbes (une ou plusieurs séries sur le même axe), bande optionnelle, ligne de référence.
export function lineChart(container, { labels, series, unit = "", decimals = 0, band, ref, height = 200, zero = false }) {
  container.innerHTML = "";
  const W = Math.round(Math.max(300, container.clientWidth || 640)), H = height, m = { t: 12, r: 44, b: 24, l: 36 };
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (ref) all.push(ref.value);
  if (band) all.push(...band.flatMap((b) => [b.low, b.high]).filter((v) => v != null));
  if (!all.length) { container.innerHTML = `<p class="empty">Pas encore de données.</p>`; return; }
  let min = Math.min(...all), max = Math.max(...all);
  if (zero) min = Math.min(0, min);
  const pad = (max - min) * 0.08 || 1;
  const ticks = niceTicks(min - (zero && min >= 0 ? 0 : pad), max + pad);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (i) => m.l + (labels.length < 2 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (labels.length - 1));
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img" });
  for (const t of ticks) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "axis0" : "grid" }, svg);
    el("text", { x: m.l - 6, y: Y(t) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = fmt(t, decimals && Math.abs(t) < 10 ? 1 : 0);
  }
  const every = Math.ceil(labels.length / 6);
  labels.forEach((lb, i) => { if (i % every === 0 || i === labels.length - 1) el("text", { x: X(i), y: H - 6, class: "tick", "text-anchor": "middle" }, svg).textContent = shortDate(lb); });
  if (band) {
    const pts = band.map((b, i) => (b.low != null ? [X(i), Y(b.high), Y(b.low)] : null)).filter(Boolean);
    if (pts.length > 1) el("path", { d: `M${pts.map((p) => `${p[0]},${p[1]}`).join("L")}L${pts.reverse().map((p) => `${p[0]},${p[2]}`).join("L")}Z`, class: "band" }, svg);
  }
  if (ref) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(ref.value), y2: Y(ref.value), class: "ref" }, svg);
    el("text", { x: W - m.r + 4, y: Y(ref.value) + 4, class: "tick" }, svg).textContent = ref.label;
  }
  for (const s of series) {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", ...(s.dash ? { "stroke-dasharray": "5 4" } : {}) }, svg);
    if (s.dots) s.values.forEach((v, i) => { if (v != null) el("circle", { cx: X(i), cy: Y(v), r: 3.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2 }, svg); });
    const li = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
    if (li != null && series.length <= 4) el("text", { x: X(li) + 6, y: Y(s.values[li]) + 4, class: "dlabel" }, svg).textContent = fmt(s.values[li], decimals);
  }
  // Calque de survol : réticule + info-bulle.
  const cross = el("line", { y1: m.t, y2: H - m.b, class: "cross", visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
  const move = (evt) => {
    const r = svg.getBoundingClientRect();
    const cx = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((cx - m.l) / (W - m.l - m.r)) * (labels.length - 1))));
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
    showTip(evt, `<b>${shortDate(labels[i])}</b>` + series.map((s) => `<div><i style="background:${s.color}"></i>${s.name} <span>${fmt(s.values[i], decimals)}${unit}</span></div>`).join("") + (band && band[i] && band[i].low != null ? `<div class="muted">Zone normale ${band[i].low}–${band[i].high}${unit}</div>` : ""));
  };
  const leave = () => { cross.setAttribute("visibility", "hidden"); hideTip(); };
  hit.addEventListener("mousemove", move); hit.addEventListener("touchstart", move, { passive: true }); hit.addEventListener("touchmove", move, { passive: true });
  hit.addEventListener("mouseleave", leave); hit.addEventListener("touchend", leave);
  container.appendChild(svg);
  legend(container, series);
  dataTable(container, ["Date", ...series.map((s) => s.name)], labels.map((lb, i) => [lb, ...series.map((s) => fmt(s.values[i], decimals))]));
}

// Barres empilées (heures par sport et par semaine).
export function stackedBars(container, { labels, series, unit = " h", height = 200 }) {
  container.innerHTML = "";
  const W = Math.round(Math.max(300, container.clientWidth || 640)), H = height, m = { t: 12, r: 12, b: 24, l: 36 };
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals));
  const y1 = ticks[ticks.length - 1];
  const bw = (W - m.l - m.r) / labels.length;
  const Y = (v) => m.t + (1 - v / y1) * (H - m.t - m.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img" });
  for (const t of ticks) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "axis0" : "grid" }, svg);
    el("text", { x: m.l - 6, y: Y(t) + 4, class: "tick", "text-anchor": "end" }, svg).textContent = fmt(t);
  }
  labels.forEach((lb, i) => {
    const x = m.l + i * bw + bw * 0.18, w = bw * 0.64;
    let acc = 0;
    const visible = series.filter((s) => s.values[i] > 0);
    visible.forEach((s, k) => {
      const v = s.values[i];
      const top = Y(acc + v), bot = Y(acc);
      const h = Math.max(0, bot - top - (k > 0 ? 2 : 0)); // 2 px d'espace entre segments
      const isTop = k === visible.length - 1;
      const r = isTop ? Math.min(4, h / 2, w / 2) : 0;
      el("path", { d: `M${x},${top + h}V${top + r}${r ? `Q${x},${top} ${x + r},${top}` : ""}H${x + w - r}${r ? `Q${x + w},${top} ${x + w},${top + r}` : ""}V${top + h}Z`, fill: s.color }, svg);
      acc += v;
    });
    if (i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) el("text", { x: x + w / 2, y: H - 6, class: "tick", "text-anchor": "middle" }, svg).textContent = shortDate(lb);
    const hit = el("rect", { x: m.l + i * bw, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
    const show = (evt) => showTip(evt, `<b>Semaine du ${shortDate(lb)}</b>` + series.filter((s) => s.values[i] > 0).map((s) => `<div><i style="background:${s.color}"></i>${s.name} <span>${fmt(s.values[i], 1)}${unit}</span></div>`).join("") + `<div class="muted">Total ${fmt(totals[i], 1)}${unit}</div>`);
    hit.addEventListener("mousemove", show); hit.addEventListener("touchstart", show, { passive: true });
    hit.addEventListener("mouseleave", hideTip); hit.addEventListener("touchend", hideTip);
  });
  container.appendChild(svg);
  legend(container, series);
  dataTable(container, ["Semaine", ...series.map((s) => s.name), "Total"], labels.map((lb, i) => [lb, ...series.map((s) => fmt(s.values[i], 1)), fmt(totals[i], 1)]));
}

// Calendrier de charge (5 semaines, une teinte du clair au foncé).
export function heatmap(container, days, { colorFor, labelFor }) {
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "heat";
  ["L", "M", "M", "J", "V", "S", "D"].forEach((d) => { const h = document.createElement("div"); h.className = "heat-h"; h.textContent = d; grid.appendChild(h); });
  const firstDow = (new Date(days[0].date + "T12:00:00").getDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement("div"));
  for (const d of days) {
    const c = document.createElement("div");
    c.className = "heat-c";
    c.style.background = colorFor(d);
    c.textContent = +d.date.slice(8);
    const show = (evt) => showTip(evt, labelFor(d));
    c.addEventListener("mousemove", show); c.addEventListener("touchstart", show, { passive: true });
    c.addEventListener("mouseleave", hideTip); c.addEventListener("touchend", hideTip);
    grid.appendChild(c);
  }
  container.appendChild(grid);
}

// Jauge de l'état de forme (nombre en vedette + arc).
export function gauge(container, score, color) {
  const r = 52, c = 2 * Math.PI * r * 0.75;
  const v = score == null ? 0 : Math.max(0, Math.min(100, score));
  container.innerHTML = `<svg viewBox="0 0 140 120" class="gauge" role="img" aria-label="État de forme ${score ?? "inconnu"} sur 100">
    <circle cx="70" cy="66" r="${r}" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c} 999" transform="rotate(135 70 66)"/>
    <circle cx="70" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} 999" transform="rotate(135 70 66)"/>
    <text x="70" y="72" text-anchor="middle" class="gauge-n">${score ?? "–"}</text>
    <text x="70" y="92" text-anchor="middle" class="gauge-u">/ 100</text></svg>`;
}
