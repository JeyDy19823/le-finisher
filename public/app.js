import { lineChart, stackedBars, heatmap, gauge } from "/charts.js";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
const SPORTS = { run: "Course", bike: "Vélo", swim: "Natation", hybrid: "CrossFit / Hyrox / renfo", other: "Autre" };
const COLORS = { run: "#3987e5", bike: "#d95926", swim: "#199e70", hybrid: "#c98500", other: "#d55181" };
const GOALS = {
  ironman: "Ironman / triathlon XXL", triathlon: "Triathlon (S, M, 70.3)", marathon: "Marathon / semi",
  trail: "Trail", hyrox: "Hyrox / CrossFit", weight: "Perte de poids", fitness: "Forme générale",
};
const STATUS = {
  vert: { color: "var(--good)", icon: "✓" }, orange: { color: "var(--warning)", icon: "!" },
  rouge: { color: "var(--critical)", icon: "✕" }, inconnu: { color: "var(--muted)", icon: "?" },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }));
const longDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

let me = null;
let data = null;
let view = "today";

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = "none"), 3500);
}
async function api(path, opts = {}) {
  const r = await fetch("/api" + path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}

// ---------- Démarrage ----------
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get("connecte")) toast(params.get("connecte") === "strava" ? "Strava connecté" : "COROS connecté");
  if (params.get("erreur")) toast({ strava: "Connexion Strava annulée", coros: "Connexion COROS annulée", "strava-scope": "Il faut autoriser l'accès aux activités Strava", "strava-config": "Strava n'est pas encore configuré sur ce site", session: "Session expirée, reconnecte-toi" }[params.get("erreur")] || "Erreur de connexion");
  if (params.toString()) history.replaceState(null, "", "/");
  try {
    me = await api("/me");
  } catch (e) {
    if (e.status === 401) return renderAuth(e.data?.inviteRequired);
    app.innerHTML = `<p class="card">Impossible de joindre le serveur : ${esc(e.message)}</p>`;
    return;
  }
  if (!me.onboarded) return renderProfile(true);
  showTabs();
  go(view);
}

function showTabs() {
  $("#tabs").hidden = false; $("#refresh").hidden = false;
  for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => go(b.dataset.view);
  $("#refresh").onclick = () => { data = null; go(view); };
}
function go(v) {
  view = v;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.view === v);
  window.scrollTo(0, 0);
  ({ today: renderToday, dash: renderDash, goal: renderGoal, settings: renderSettings })[v]();
}
async function loadPoint(force) {
  if (data && !force) return data;
  data = await api("/point");
  for (const err of data.errors || []) toast(`${err.source === "strava" ? "Strava" : "COROS"} : ${err.message}`);
  return data;
}

// ---------- Accès ----------
function renderAuth(inviteRequired) {
  $("#tabs").hidden = true;
  app.innerHTML = `
  <div class="hero"><h1>Ton point de forme, chaque matin</h1>
  <p class="sub">Branche Strava et/ou ta montre COROS, choisis ton objectif, et l'appli te dit comment tu es ce matin et quelle séance faire.</p></div>
  <div class="card"><h2>Créer mon espace</h2>
    ${inviteRequired ? `<label for="invite">Code d'invitation</label><input id="invite" autocomplete="off" placeholder="Donné par l'organisateur">` : ""}
    <p><button class="primary" id="signup">Commencer</button></p></div>
  <div class="card"><h2>J'ai déjà un espace</h2>
    <p class="muted">Sur un nouveau téléphone ou ordinateur, entre ton code de récupération.</p>
    <input id="code" placeholder="XXXX-XXXX-XXXX" autocomplete="off">
    <p><button id="login">Me reconnecter</button></p></div>`;
  $("#signup").onclick = async () => {
    try {
      const r = await api("/signup", { method: "POST", body: { invite: $("#invite")?.value } });
      app.innerHTML = `<div class="card"><h2>Garde ce code précieusement</h2>
        <p class="sub">C'est ta clé pour retrouver ton espace sur un autre appareil. Il ne sera plus affiché (tu pourras en générer un nouveau dans les réglages).</p>
        <div class="code">${esc(r.recoveryCode)}</div>
        <div class="split"><button id="copy">Copier</button><button class="primary" id="next">C'est noté</button></div></div>`;
      $("#copy").onclick = () => navigator.clipboard?.writeText(r.recoveryCode).then(() => toast("Code copié"));
      $("#next").onclick = () => boot();
    } catch (e) { toast(e.message); }
  };
  $("#login").onclick = async () => {
    try { await api("/login", { method: "POST", body: { code: $("#code").value } }); boot(); } catch (e) { toast(e.message); }
  };
}

// ---------- Profil et objectif ----------
function renderProfile(first) {
  const p = me.profile || { sports: [], goal: {} };
  const g = p.goal || {};
  $("#tabs").hidden = first;
  app.innerHTML = `
  <div class="card">
    <h1>${first ? "On fait connaissance" : "Mon profil"}</h1>
    <p class="sub">${first ? "Ces infos servent à calculer ta charge et à adapter les séances. Tu pourras tout changer plus tard." : ""}</p>
    <label for="name">Prénom</label><input id="name" value="${esc(p.name || "")}" maxlength="40">
    <label>Tes sports</label>
    <div class="chips" id="sports">${Object.entries(SPORTS).map(([k, v]) => `<button type="button" class="chip ${p.sports?.includes(k) ? "on" : ""}" data-k="${k}">${v}</button>`).join("")}</div>
    <label for="goalType">Ton objectif principal</label>
    <select id="goalType">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${g.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <div class="grid2">
      <div><label for="goalName">Nom de l'objectif (facultatif)</label><input id="goalName" value="${esc(g.name || "")}" placeholder="Ex. Ironman de Nice"></div>
      <div><label for="goalDate">Date de l'objectif</label><input id="goalDate" type="date" value="${esc(g.date || "")}"></div>
      <div><label for="tw">Poids visé en kg (facultatif)</label><input id="tw" type="number" step="0.1" inputmode="decimal" value="${esc(g.targetWeight || "")}"></div>
      <div><label for="twd">Pour quand ?</label><input id="twd" type="date" value="${esc(g.weightDate || "")}"></div>
    </div>
  </div>
  <div class="card">
    <h2>Pour des calculs plus justes</h2>
    <div class="grid2">
      <div><label for="sex">Sexe</label><select id="sex"><option value="m">Homme</option><option value="f" ${p.sex === "f" ? "selected" : ""}>Femme</option></select></div>
      <div><label for="hours">Heures d'entraînement dispo par semaine</label><input id="hours" type="number" inputmode="decimal" value="${esc(p.hoursPerWeek || "")}"></div>
      <div><label for="hrMax">FC max (bpm)</label><input id="hrMax" type="number" inputmode="numeric" value="${esc(p.hrMax || "")}" placeholder="Ex. 185"></div>
      <div><label for="hrRest">FC de repos (bpm)</label><input id="hrRest" type="number" inputmode="numeric" value="${esc(p.hrRest || "")}" placeholder="Ex. 55"></div>
    </div>
    ${me.aiAvailable ? `<label class="row" style="margin-top:14px"><input type="checkbox" id="ai" style="width:auto" ${p.aiEnabled ? "checked" : ""}> Activer le coach IA (il ne lit que tes données COROS et tes saisies, jamais Strava)</label>` : ""}
  </div>
  <button class="primary" id="save" style="width:100%">${first ? "Continuer" : "Enregistrer"}</button>`;
  for (const c of document.querySelectorAll("#sports .chip")) c.onclick = () => c.classList.toggle("on");
  $("#save").onclick = async () => {
    const sports = [...document.querySelectorAll("#sports .chip.on")].map((c) => c.dataset.k);
    if (!$("#name").value.trim()) return toast("Indique ton prénom");
    if (!sports.length) return toast("Choisis au moins un sport");
    const profile = {
      name: $("#name").value.trim(), sex: $("#sex").value, sports,
      hrMax: $("#hrMax").value, hrRest: $("#hrRest").value, hoursPerWeek: $("#hours").value,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, aiEnabled: $("#ai")?.checked || false,
      goal: { type: $("#goalType").value, name: $("#goalName").value, date: $("#goalDate").value, targetWeight: $("#tw").value, weightDate: $("#twd").value },
    };
    try {
      me = await api("/profile", { method: "POST", body: { profile } });
      data = null;
      showTabs();
      if (first) { go("settings"); toast("Profil enregistré. Connecte maintenant tes applis."); } else { toast("Profil enregistré"); go("settings"); }
    } catch (e) { toast(e.message); }
  };
}

// ---------- Aujourd'hui ----------
function badge(level, label) {
  const s = STATUS[level] || STATUS.inconnu;
  return `<span class="badge"><span class="ic" style="background:${s.color}">${s.icon}</span>${esc(label)}</span>`;
}

async function renderToday() {
  app.innerHTML = `<p class="loading">Je récupère tes données…</p>`;
  let d;
  try { d = await loadPoint(); } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  if (view !== "today") return; // l'utilisateur a changé d'onglet entre-temps
  const p = d.point;
  const r = p.readiness;
  const st = STATUS[r.level] || STATUS.inconnu;
  const ci = (me.checkins || {})[p.today] || {};
  const noSource = !d.sources.strava && !d.sources.coros;
  app.innerHTML = `
  <h1>Salut ${esc(me.profile.name)}</h1>
  <p class="sub">${longDate(p.today)}${p.phase.daysLeft != null && p.phase.daysLeft >= 0 ? ` · J-${p.phase.daysLeft} avant ${esc(me.profile.goal.name || GOALS[me.profile.goal.type])}` : ""}</p>
  ${noSource ? `<div class="alert">Aucune appli connectée : le point se base seulement sur tes saisies. <a href="#" id="toSettings">Connecter Strava ou COROS</a></div>` : ""}
  <div class="card">
    <div class="status"><div id="gauge"></div>
      <div>${badge(r.level, r.label)}
        <p class="sub" style="margin-top:8px">${esc(summaryLine(p))}</p>
      </div></div>
    <ul class="parts">${r.parts.map((x) => `<li><span>${esc(x.label)}<br><span class="d">${esc(x.detail)}</span></span><span class="bar" style="width:90px"><i style="width:${x.score}%;background:${x.score >= 75 ? "var(--good)" : x.score >= 55 ? "var(--warning)" : "var(--critical)"}"></i></span><span class="d" style="text-align:right">${x.score}/100</span></li>`).join("")}</ul>
  </div>
  ${p.alerts.map((a) => `<div class="alert">${esc(a)}</div>`).join("")}
  <h2>Séances proposées</h2>
  ${p.alreadyDone.length ? `<p class="muted">Déjà fait aujourd'hui : ${esc(p.alreadyDone.join(", "))}</p>` : ""}
  <div class="grid2">${p.proposals.map((s) => `<div class="card session" style="border-left-color:${COLORS[s.category]}">
    <div class="axis">${esc(s.axis)}</div><h3>${esc(s.title)}</h3><div class="dur">${s.duration} min</div><p>${esc(s.detail)}</p></div>`).join("")}</div>
  ${me.aiAvailable && me.profile.aiEnabled ? `<div class="card coach"><h2>Le mot du coach</h2><p class="muted" id="coachText">Un point rédigé à partir de COROS et de tes saisies.</p><p><button id="coachBtn">Rédiger mon point</button></p></div>` : ""}
  <div class="card"><h2>Mon ressenti du jour</h2>
    <div class="grid2">
      <div><label for="w">Poids (kg)</label><input id="w" type="number" step="0.1" inputmode="decimal" value="${esc(ci.weight || "")}"></div>
      <div></div>
    </div>
    ${scale("sleep", "Qualité du sommeil", ci.sleep, "1 = nuit pourrie, 5 = excellente")}
    ${scale("fatigue", "Fatigue", ci.fatigue, "1 = pleine forme, 5 = épuisé")}
    ${scale("soreness", "Courbatures", ci.soreness, "1 = aucune, 5 = très fortes")}
    ${scale("mood", "Moral", ci.mood, "1 = bas, 5 = au top")}
    <label for="note">Note</label><textarea id="note" maxlength="500">${esc(ci.note || "")}</textarea>
    <p><button class="primary" id="saveCi">Enregistrer</button></p>
  </div>
  <div class="card"><h2>Ma semaine</h2>${weekLine(p.week)}</div>
  ${d.sources.strava ? `<div class="powered">Données d'activité <b>Powered by Strava</b></div>` : ""}`;
  gauge($("#gauge"), r.score, st.color);
  $("#toSettings")?.addEventListener("click", (e) => { e.preventDefault(); go("settings"); });
  for (const sc of document.querySelectorAll(".scale")) for (const b of sc.querySelectorAll("button")) b.onclick = () => { sc.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); };
  $("#saveCi").onclick = async () => {
    const checkin = { weight: $("#w").value, note: $("#note").value };
    for (const sc of document.querySelectorAll(".scale")) checkin[sc.dataset.k] = sc.querySelector("button.on")?.dataset.v;
    try { const r2 = await api("/checkin", { method: "POST", body: { checkin } }); me.checkins = r2.checkins; data = null; toast("Ressenti enregistré"); renderToday(); } catch (e) { toast(e.message); }
  };
  $("#coachBtn")?.addEventListener("click", async () => {
    const b = $("#coachBtn"); b.disabled = true; $("#coachText").textContent = "Le coach rédige…";
    try { const r3 = await api("/coach", { method: "POST", body: {} }); $("#coachText").className = ""; $("#coachText").textContent = r3.text; b.textContent = "Réécrire"; b.onclick = async () => { b.disabled = true; const r4 = await api("/coach", { method: "POST", body: { force: true } }).catch((e) => ({ text: e.message })); $("#coachText").textContent = r4.text; b.disabled = false; }; }
    catch (e) { $("#coachText").textContent = e.message; }
    b.disabled = false;
  });
}

function scale(k, label, val, hint) {
  return `<label>${label} <span class="muted">(${hint})</span></label><div class="scale" data-k="${k}">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-v="${v}" class="${Number(val) === v ? "on" : ""}">${v}</button>`).join("")}</div>`;
}
function summaryLine(p) {
  const r = p.readiness;
  if (r.level === "inconnu") return "Connecte une appli ou remplis ton ressenti pour avoir ton état de forme.";
  if (r.level === "vert") return "Tu peux charger aujourd'hui, c'est le bon jour pour la séance clé.";
  if (r.level === "orange") return "Corps un peu entamé : séance de qualité possible mais dosée, ou endurance tranquille.";
  return "Le corps demande de la récup : séance très légère ou repos, et sommeil en priorité.";
}
function weekLine(w) {
  const diff = (a, b) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)} % vs sem. préc.` : "");
  return `<div class="kpis" style="margin:0">
    <div class="kpi"><span>Heures</span><b>${nf(w.current.hours, 1)}</b><small>${diff(w.current.hours, w.previous.hours)}</small></div>
    <div class="kpi"><span>Séances</span><b>${w.current.sessions}</b><small>${w.previous.sessions} la semaine d'avant</small></div>
    <div class="kpi"><span>Charge</span><b>${w.current.load}</b><small>${diff(w.current.load, w.previous.load)}</small></div>
    <div class="kpi"><span>Kilomètres</span><b>${w.current.km}</b><small>${w.previous.km} km avant</small></div></div>
    <p class="muted">Sur les 7 derniers jours glissants.</p>`;
}

// ---------- Tableaux de bord ----------
async function renderDash() {
  app.innerHTML = `<p class="loading">Préparation des tableaux de bord…</p>`;
  let d;
  try { d = await loadPoint(); } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  if (view !== "dash") return; // l'utilisateur a changé d'onglet entre-temps
  const p = d.point, db = p.dashboards, h = d.health;
  const tsbTxt = p.load.tsb > 5 ? "frais" : p.load.tsb >= -10 ? "équilibré" : p.load.tsb >= -25 ? "en surcharge productive" : "très fatigué";
  app.innerHTML = `
  <h1>Tableaux de bord</h1>
  <div class="kpis">
    <div class="kpi"><span>Forme de fond (CTL)</span><b>${nf(p.load.ctl)}</b><small>moyenne 42 j</small></div>
    <div class="kpi"><span>Fatigue (ATL)</span><b>${nf(p.load.atl)}</b><small>moyenne 7 j</small></div>
    <div class="kpi"><span>Fraîcheur (TSB)</span><b>${p.load.tsb > 0 ? "+" : ""}${nf(p.load.tsb)}</b><small>${tsbTxt}</small></div>
    <div class="kpi"><span>Ratio charge</span><b>${nf(p.load.ratio, 2)}</b><small>zone sûre 0,8 à 1,3</small></div>
  </div>
  <div class="card"><h2>Courbe de forme, 90 jours</h2><p class="muted">La fraîcheur du jour = forme de fond de la veille moins fatigue de la veille.</p><div id="c-pmc"></div></div>
  <div class="card"><h2>Volume par semaine et par sport</h2><div id="c-vol"></div></div>
  <div class="card"><h2>Calendrier de charge, 5 semaines</h2><div id="c-heat"></div><p class="muted">Plus la case est claire, plus la journée a été chargée.</p></div>
  <div class="card"><h2>Poids</h2><div id="c-weight"></div>${weightLine(p.weight.status)}</div>
  ${h.hrvHistory?.length ? `<div class="card"><h2>VFC de la nuit (COROS)</h2><div id="c-hrv"></div></div>` : ""}
  ${h.sleepHistory?.length ? `<div class="card"><h2>Score de sommeil (COROS)</h2><div id="c-sleep"></div></div>` : ""}
  ${h.rhrHistory?.length ? `<div class="card"><h2>FC de repos (COROS)</h2><div id="c-rhr"></div></div>` : ""}
  ${h.corosLoad?.length ? `<div class="card"><h2>Avis de charge COROS</h2>${h.corosLoad.slice(0, 3).map((l) => `<div class="conn"><span>${longDate(l.date)}</span><span>${esc(l.comment)} · ratio ${nf(l.ratio, 2)}</span></div>`).join("")}</div>` : ""}
  <div class="card"><h2>Dernières séances</h2>${recentList(db.recent)}</div>
  ${d.sources.strava ? `<div class="powered">Données d'activité <b>Powered by Strava</b></div>` : ""}`;

  lineChart($("#c-pmc"), {
    labels: db.pmc.map((x) => x.date),
    series: [
      { name: "Forme de fond (CTL)", color: COLORS.run, values: db.pmc.map((x) => x.ctl) },
      { name: "Fatigue (ATL)", color: COLORS.bike, values: db.pmc.map((x) => x.atl) },
      { name: "Fraîcheur (TSB)", color: COLORS.swim, values: db.pmc.map((x) => x.tsb) },
    ], height: 220,
  });
  const used = Object.keys(SPORTS).filter((k) => db.weekly.some((w) => w[k] > 0));
  stackedBars($("#c-vol"), { labels: db.weekly.map((w) => w.week), series: used.map((k) => ({ name: SPORTS[k], color: COLORS[k], values: db.weekly.map((w) => w[k]) })) });
  const maxLoad = Math.max(1, ...db.calendar.map((c) => c.load));
  const ramp = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"];
  heatmap($("#c-heat"), db.calendar, {
    colorFor: (c) => (c.load ? ramp[Math.min(4, Math.floor((c.load / maxLoad) * 4.999))] : "var(--surface-2)"),
    labelFor: (c) => `<b>${longDate(c.date)}</b><div>Charge <span>${c.load}</span></div>${c.sports.map((s) => `<div><i style="background:${COLORS[s]}"></i>${SPORTS[s]}</div>`).join("")}`,
  });
  const wp = p.weight.points.slice(-60);
  lineChart($("#c-weight"), {
    labels: wp.map((x) => x.date), decimals: 1, unit: " kg",
    series: [{ name: "Moyenne 7 jours", color: COLORS.run, values: wp.map((x) => x.avg7) }, { name: "Pesée", color: COLORS.other, values: wp.map((x) => x.weight), dots: true, dash: true }],
    ref: p.weight.status?.target ? { value: p.weight.status.target, label: "cible" } : null,
  });
  if (h.hrvHistory?.length) lineChart($("#c-hrv"), { labels: h.hrvHistory.map((x) => x.date), unit: " ms", series: [{ name: "VFC", color: COLORS.swim, values: h.hrvHistory.map((x) => x.value), dots: true }], band: h.hrvHistory.map((x) => ({ low: x.low, high: x.high })) });
  if (h.sleepHistory?.length) lineChart($("#c-sleep"), { labels: h.sleepHistory.map((x) => x.date), series: [{ name: "Score", color: COLORS.run, values: h.sleepHistory.map((x) => x.score), dots: true }] });
  if (h.rhrHistory?.length) { const rr = [...h.rhrHistory].reverse(); lineChart($("#c-rhr"), { labels: rr.map((x) => x.date), unit: " bpm", series: [{ name: "FC repos", color: COLORS.bike, values: rr.map((x) => x.bpm), dots: true }] }); }
}

function weightLine(s) {
  if (!s) return `<p class="muted">Saisis ton poids dans « Mon ressenti du jour » et fixe un poids visé dans ton profil pour suivre ta trajectoire.</p>`;
  const onTrack = s.ratePerWeek != null && s.neededPerWeek != null && s.ratePerWeek <= s.neededPerWeek;
  return `<p>${nf(s.current, 1)} kg en moyenne, encore ${nf(s.toGo, 1)} kg pour atteindre ${nf(s.target, 1)} kg${s.deadline ? ` d'ici le ${longDate(s.deadline)}` : ""}.
  ${s.neededPerWeek != null ? `Rythme nécessaire : ${nf(s.neededPerWeek, 2)} kg par semaine.` : ""}
  ${s.ratePerWeek != null ? ` Rythme actuel : ${nf(s.ratePerWeek, 2)} kg par semaine, ${onTrack ? "tu es dans les clous." : "un peu en retard sur le plan."}` : ""}</p>`;
}
function recentList(list) {
  if (!list.length) return `<p class="empty">Aucune séance sur les 14 derniers jours.</p>`;
  return `<ul class="acts">${list.map((a) => `<li><span class="dot" style="background:${COLORS[a.category]}"></span>
    <span>${esc(a.name || SPORTS[a.category])}<br><span class="meta">${longDate(a.date)} · ${a.durationMin} min${a.distanceKm ? ` · ${nf(a.distanceKm, 1)} km` : ""}${a.avgHr ? ` · ${a.avgHr} bpm` : ""} · charge ${a.load}</span></span>
    <span>${a.url ? `<a href="${a.url}" target="_blank" rel="noopener">Voir sur Strava</a>` : `<span class="meta">COROS</span>`}</span></li>`).join("")}</ul>`;
}

// ---------- Objectif ----------
async function renderGoal() {
  const g = me.profile.goal || {};
  app.innerHTML = `<p class="loading">…</p>`;
  let d; try { d = await loadPoint(); } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  if (view !== "goal") return; // l'utilisateur a changé d'onglet entre-temps
  const ph = d.point.phase;
  const phases = [["foncier", "Foncier", "#104281"], ["developpement", "Développement", "#1c5cab"], ["specifique", "Spécifique", "#2a78d6"], ["affutage", "Affûtage", "#5598e7"], ["course", "Objectif", "#86b6ef"]];
  const advice = {
    foncier: "Volume en endurance fondamentale, technique de nage, renfo 2 fois par semaine. 80 % du temps en Z1-Z2.",
    developpement: "On monte le volume par paliers (3 semaines de charge, 1 de récup) et on ajoute du seuil.",
    specifique: "Séances à l'allure objectif, enchaînements, sorties longues avec la nutrition de course.",
    affutage: "Volume en baisse de 30 à 50 %, on garde l'intensité courte. Sommeil et alimentation au carré.",
    course: "Semaine de l'objectif : rien de nouveau, rappels d'allure courts, repos et glucides les 2 derniers jours.",
    post: "Récupération active 1 à 2 semaines, puis on fixe le prochain objectif.",
    continu: "Pas de date fixée : on alterne 3 semaines de progression et 1 semaine plus légère.",
  };
  app.innerHTML = `
  <h1>${esc(g.name || GOALS[g.type])}</h1>
  <div class="card">
    ${ph.daysLeft != null ? `<div class="kpis" style="margin:0"><div class="kpi"><span>Jours restants</span><b>${Math.max(0, ph.daysLeft)}</b></div><div class="kpi"><span>Semaines</span><b>${Math.max(0, ph.weeksLeft)}</b></div><div class="kpi"><span>Phase</span><b style="font-size:16px">${esc(ph.label)}</b></div><div class="kpi"><span>Date</span><b style="font-size:16px">${new Date(g.date + "T12:00:00").toLocaleDateString("fr-FR")}</b></div></div>` : `<p class="sub">Pas de date fixée. Ajoute-en une dans ton profil pour avoir le compte à rebours et les phases.</p>`}
    ${ph.daysLeft != null ? `<div class="timeline">${phases.map(([k, , c]) => `<i style="flex:${{ foncier: 3, developpement: 3, specifique: 2, affutage: 1, course: 0.4 }[k]};background:${c};opacity:${k === ph.key ? 1 : 0.35}"></i>`).join("")}</div>
    <div class="row muted" style="justify-content:space-between">${phases.map(([k, l]) => `<span style="${k === ph.key ? "color:var(--text);font-weight:600" : ""}">${l}</span>`).join("")}</div>` : ""}
  </div>
  <div class="card"><h2>Ce qui compte en ce moment</h2><p>${esc(advice[ph.key])}</p></div>
  <div class="card"><h2>Poids</h2>${weightLine(d.point.weight.status)}</div>
  <button id="edit" style="width:100%">Modifier mon objectif</button>`;
  $("#edit").onclick = () => renderProfile(false);
}

// ---------- Réglages ----------
function renderSettings() {
  app.innerHTML = `
  <h1>Réglages</h1>
  <div class="card"><h2>Mes applis</h2>
    <div class="conn"><div><b>Strava</b><br><span class="muted">${me.strava.connected ? `<span class="ok">Connecté</span>${me.strava.firstname ? " · " + esc(me.strava.firstname) : ""}` : "Activités, durées, fréquence cardiaque"}</span></div>
      ${me.strava.connected ? `<button id="stravaOff">Déconnecter</button>` : me.stravaAvailable ? `<a class="btn strava" href="/api/strava/connect">Se connecter avec Strava</a>` : `<span class="muted">Non configuré</span>`}</div>
    <div class="conn"><div><b>COROS</b><br><span class="muted">${me.coros.connected ? `<span class="ok">Connecté</span> · région ${esc(me.coros.region.toUpperCase())}` : "Activités, VFC, sommeil, récupération"}</span></div>
      ${me.coros.connected ? `<button id="corosOff">Déconnecter</button>` : `<div class="row"><select id="region" style="width:auto"><option value="eu">Europe</option><option value="us">États-Unis</option><option value="cn">Chine</option></select><button class="primary" id="corosOn">Connecter</button></div>`}</div>
    <p class="muted">Chacun connecte ses propres comptes. Tes données ne sont visibles que par toi. Si ta montre COROS est déjà synchronisée avec Strava, les doublons sont fusionnés automatiquement.</p>
  </div>
  <div class="card"><h2>Profil et objectif</h2><p class="sub">${esc(me.profile.name)} · ${esc(GOALS[me.profile.goal?.type] || "")} · ${me.profile.sports.map((s) => SPORTS[s]).join(", ")}</p><button id="editProfile">Modifier</button></div>
  <div class="card"><h2>Accès depuis un autre appareil</h2><p class="muted">Génère un nouveau code de récupération (l'ancien ne marchera plus).</p><button id="newCode">Nouveau code</button><div id="codeOut"></div></div>
  <div class="card"><h2>Mes données</h2>
    <div class="row"><a class="btn" href="/api/export">Exporter (JSON)</a><button id="logout">Me déconnecter</button><button class="danger" id="del">Supprimer mon compte</button></div>
    <p class="muted">Les activités Strava ne sont jamais stockées : elles sont lues à chaque ouverture. On garde seulement ton profil, tes saisies et des jetons de connexion chiffrés.</p></div>
  <div class="card flat"><p class="muted">Installer l'appli : sur iPhone, bouton Partager puis « Sur l'écran d'accueil ». Sur Android, menu ⋮ puis « Installer l'application ».</p></div>`;
  $("#editProfile").onclick = () => renderProfile(false);
  $("#corosOn")?.addEventListener("click", () => (location.href = `/api/coros/connect?region=${$("#region").value}`));
  $("#stravaOff")?.addEventListener("click", async () => { me = await api("/strava/disconnect", { method: "POST" }); data = null; renderSettings(); });
  $("#corosOff")?.addEventListener("click", async () => { me = await api("/coros/disconnect", { method: "POST" }); data = null; renderSettings(); });
  $("#newCode").onclick = async () => { const r = await api("/recovery-code", { method: "POST" }); $("#codeOut").innerHTML = `<div class="code">${esc(r.recoveryCode)}</div>`; };
  $("#logout").onclick = async () => { await api("/logout", { method: "POST" }); location.reload(); };
  $("#del").onclick = async () => {
    if (!confirm("Supprimer définitivement ton compte et tes saisies ?")) return;
    await api("/account", { method: "DELETE" }); location.reload();
  };
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
boot();
