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
  if (demo) {
    if (path === "/vestiaire") return demo.vestiaire;
    if (path === "/me") return demo.me;
    const e = new Error("En démo rien n'est enregistré : crée ton espace pour de vrai !"); e.status = 0; toast(e.message); throw e;
  }
  const r = await fetch("/api" + path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; e.data = j; throw e; }
  return j;
}

// ---------- Démarrage ----------
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get("connecte")) toast(params.get("connecte") === "strava" ? "Strava connecté" : "COROS connecté");
  if (params.get("erreur")) toast({ strava: "Connexion Strava annulée", coros: "Connexion COROS annulée", "strava-scope": "Il faut autoriser l'accès aux activités Strava", "strava-config": "Strava n'est pas encore configuré sur ce site", session: "Session expirée, reconnecte-toi", invitation: "Code d'invitation manquant ou incorrect pour créer ton espace", "coros-login": "COROS n'a pas donné d'identifiant de compte : crée ton espace sans compte puis connecte COROS dans les réglages" }[params.get("erreur")] || "Erreur de connexion");
  if (params.toString()) history.replaceState(null, "", "/");
  try {
    me = await api("/me");
  } catch (e) {
    if (e.status === 401) return renderAuth(e.data?.inviteRequired, e.data?.stravaAvailable);
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
  $("#refresh").onclick = () => { if (!demo) data = null; go(view); };
}
function go(v) {
  view = v;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.view === v);
  window.scrollTo(0, 0);
  ({ today: renderToday, dash: renderDash, game: renderGame, goal: renderGoal, settings: renderSettings })[v]();
}
async function loadPoint(force) {
  if (data && (!force || demo)) return data;
  data = await api("/point");
  celebrate(data.game);
  for (const err of data.errors || []) toast(`${err.source === "strava" ? "Strava" : "COROS"} : ${err.message}`);
  return data;
}

// ---------- Accueil, démo et accès ----------
// Inspiré des projets fitness open source de GitHub (Endurain, Lyftr, wingfit, openGym) :
// une promesse en une phrase, l'aperçu du vrai écran, une démo jouable sans compte,
// et un mot clair sur la confidentialité.
let demo = null;

function renderAuth(inviteRequired, stravaAvailable) {
  $("#tabs").hidden = true; $("#refresh").hidden = true;
  document.body.classList.add("landing");
  app.innerHTML = `
  <section class="hero2">
    <span class="eyebrow">Triathlon · course · vélo · Hyrox</span>
    <h1>Chaque matin,<br><span class="grad">ton feu vert.</span></h1>
    <p class="lead">Le Finisher lit ta montre COROS et ton Strava, te dit comment tu es ce matin et te donne la séance qui va avec. Et pour ne rien lâcher, des défis entre potes.</p>
    <div class="cta-row"><button class="primary big" id="tryDemo">Essayer la démo</button><a class="btn big" href="#join">Créer mon espace</a></div>
    <p class="muted small">Sans inscription, avec des données fictives.</p>
  </section>
  <section class="phone" aria-hidden="true">
    <div class="screen">
      <div class="m-lvl"><span class="num">6</span><div><b>Finisher</b><div class="xpbar"><i style="width:42%"></i></div></div><span class="m-fire">🔥 12</span></div>
      <div class="m-card"><div id="demoGauge"></div><div><span class="badge"><span class="ic" style="background:var(--good)">✓</span>Feu vert</span><p class="muted small">VFC dans ta zone, sommeil 84, récup 88 %</p></div></div>
      <div class="m-sess" style="border-color:var(--bike)"><small>Axe triathlon</small><b>Vélo : sweet spot</b><span>75 min</span></div>
      <div class="m-sess" style="border-color:var(--hybrid)"><small>Axe CrossFit / Hyrox</small><b>Hyrox : simulation</b><span>60 min</span></div>
      <div class="m-quest"><span class="check on">✓</span>Ressenti du jour<span class="xp">+20 XP</span></div>
      <div class="m-quest"><span class="check" id="mq"></span>Séance proposée<span class="xp">+40 XP</span></div>
      <div class="pop" id="pop">+40 XP</div>
    </div>
  </section>
  <section class="steps">
    <h2>Comment ça marche</h2>
    <ol>
      <li><b>Branche ta montre</b><span>COROS et/ou Strava, en deux clics. Pas de montre ? Ton ressenti suffit pour démarrer.</span></li>
      <li><b>Choisis ton objectif</b><span>Ironman, marathon, Hyrox, perte de poids… L'appli cale les phases jusqu'au jour J.</span></li>
      <li><b>Lis ton point chaque matin</b><span>Ta forme sur 100, deux séances adaptées, tes quêtes du jour.</span></li>
    </ol>
  </section>
  <section class="feats">
    <div><span>🚦</span><b>Feu vert, orange ou rouge</b><p>VFC, sommeil, récup, charge et ressenti en une note claire.</p></div>
    <div><span>🏊🚴🏃</span><b>Deux séances par jour</b><p>Un axe triathlon et un axe CrossFit / Hyrox, dosés selon ta forme.</p></div>
    <div><span>🏆</span><b>Défis et vestiaire</b><p>Quêtes, XP, 20 badges, et un classement de la semaine entre potes.</p></div>
    <div><span>📈</span><b>Tableaux de bord</b><p>Courbe de forme, volume par sport, poids, VFC et sommeil.</p></div>
  </section>
  <section class="trust card">
    <h2>🔒 Tes données restent à toi</h2>
    <ul><li>Chacun ne voit que ses propres séances.</li><li>Rien n'est revendu, rien ne sert à entraîner une IA.</li><li>Tu exportes ou supprimes tout en un clic.</li></ul>
    <div class="chips"><span class="chip">COROS</span><span class="chip">Strava</span><span class="chip">Saisie manuelle</span><span class="chip">Installable sur téléphone</span></div>
  </section>
  <section class="card" id="join">
    <h2>Rejoindre l'équipe</h2>
    ${inviteRequired ? `<label for="invite">Code d'invitation</label><input id="invite" autocomplete="off" placeholder="Celui que ton pote t'a envoyé">` : `<p class="sub">Ça prend deux minutes.</p>`}
    <div class="oauth">
      ${stravaAvailable ? `<button class="btn big conn-big strava" id="withStrava"><span>🟧</span><div><b>Continuer avec Strava</b><small>Ton compte Strava devient ta clé d'accès</small></div></button>` : ""}
      <button class="btn big conn-big" id="withCoros"><span>⌚</span><div><b>Continuer avec COROS</b><small>Ton compte COROS devient ta clé d'accès</small></div></button>
    </div>
    <div class="or"><span>ou</span></div>
    <p><button class="primary big" id="signup" style="width:100%">Créer mon espace sans compte</button></p>
    <p class="muted small">Déjà inscrit avec Strava ou COROS ? Clique sur le même bouton, tu retrouves ton espace (pas besoin du code d'invitation).</p>
    <details><summary class="muted">J'ai déjà un espace sur un autre appareil</summary>
      <input id="code" placeholder="XXXX-XXXX-XXXX" autocomplete="off" style="margin-top:8px"><p><button id="login">Me reconnecter</button></p></details>
  </section>
  <div class="sticky-cta"><button class="primary" id="tryDemo2">Essayer la démo</button><a class="btn" href="#join">Créer mon espace</a></div>`;
  // Petite animation de l'aperçu : la jauge monte, la quête se coche, l'XP s'affiche.
  let n = 0;
  const tick = setInterval(() => {
    n = Math.min(86, n + 3);
    if (!document.getElementById("demoGauge")) return clearInterval(tick);
    gauge($("#demoGauge"), n, "var(--good)");
    if (n >= 86) { clearInterval(tick); setTimeout(() => { const q = $("#mq"); if (q) { q.classList.add("on"); q.textContent = "✓"; $("#pop")?.classList.add("show"); } }, 500); }
  }, 30);
  $("#tryDemo").onclick = $("#tryDemo2").onclick = startDemo;
  const inv = () => encodeURIComponent($("#invite")?.value.trim() || "");
  $("#withStrava")?.addEventListener("click", () => (location.href = `/api/strava/login?invite=${inv()}`));
  $("#withCoros").onclick = () => (location.href = `/api/coros/login?region=eu&invite=${inv()}`);
  // La barre d'action du bas n'apparaît qu'une fois les boutons du haut sortis de l'écran.
  new IntersectionObserver(([e]) => document.body.classList.toggle("scrolled", !e.isIntersecting)).observe($(".cta-row"));
  $("#signup").onclick = async () => {
    try {
      const r = await api("/signup", { method: "POST", body: { invite: $("#invite")?.value } });
      document.body.classList.remove("landing");
      app.innerHTML = `<div class="card"><h2>Bienvenue dans l'équipe 👋</h2>
        <p class="sub">Voici ta clé pour retrouver ton espace sur un autre appareil. Garde-la dans tes notes, elle ne sera plus affichée.</p>
        <div class="code">${esc(r.recoveryCode)}</div>
        <div class="split"><button id="copy">Copier</button><button class="primary" id="next">C'est noté</button></div></div>`;
      $("#copy").onclick = () => navigator.clipboard?.writeText(r.recoveryCode).then(() => toast("Code copié"));
      $("#next").onclick = () => boot();
    } catch (e) { toast(e.message); }
  };
  $("#login").onclick = async () => {
    try { await api("/login", { method: "POST", body: { code: $("#code").value } }); document.body.classList.remove("landing"); boot(); } catch (e) { toast(e.message); }
  };
}

async function startDemo() {
  try { demo = await (await fetch("/demo.json")).json(); } catch { return toast("Démo indisponible"); }
  me = demo.me; data = demo.point;
  document.body.classList.remove("landing");
  document.body.classList.add("demo");
  const bar = document.createElement("div");
  bar.className = "demobar";
  bar.innerHTML = `<span>Démo avec des données fictives</span><a href="/" id="leaveDemo">Créer mon espace →</a>`;
  document.body.prepend(bar);
  showTabs();
  go("today");
}

// ---------- Profil et objectif ----------
// Inscription en 3 étapes courtes plutôt qu'un long formulaire.
const SPORT_ICONS = { swim: "🏊", bike: "🚴", run: "🏃", hybrid: "🏋️", other: "🧗" };
const GOAL_ICONS = { ironman: "🔱", triathlon: "🏅", marathon: "🏃", trail: "⛰️", hyrox: "🏋️", weight: "⚖️", fitness: "💚" };
let wiz = null;
function renderWizard(step = 1) {
  wiz = wiz || { name: me.strava?.firstname || "", sports: [], goal: { type: "" }, vestiaire: true };
  $("#tabs").hidden = true;
  const dots = [1, 2, 3, 4].map((i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("");
  const nav = (next = "Suivant", skip = false) => `<div class="split wiz-nav">${step > 1 ? `<button id="back">Retour</button>` : ""}${skip ? `<button id="skip">Passer</button>` : ""}<button class="primary" id="nextStep">${next}</button></div>`;
  if (step === 1) {
    app.innerHTML = `<div class="wiz"><div class="dots">${dots}</div><h1>Salut ! Tu t'appelles comment&nbsp;?</h1>
      <input id="name" value="${esc(wiz.name)}" maxlength="40" placeholder="Ton prénom" autofocus>
      <h2 style="margin-top:22px">Tu pratiques quoi&nbsp;?</h2><p class="muted">Plusieurs choix possibles.</p>
      <div class="tiles">${Object.entries(SPORTS).map(([k, v]) => `<button type="button" class="tile ${wiz.sports.includes(k) ? "on" : ""}" data-k="${k}"><span>${SPORT_ICONS[k]}</span>${v}</button>`).join("")}</div>
      ${nav()}</div>`;
    for (const t of document.querySelectorAll(".tile")) t.onclick = () => t.classList.toggle("on");
    $("#nextStep").onclick = () => {
      wiz.name = $("#name").value.trim();
      wiz.sports = [...document.querySelectorAll(".tile.on")].map((t) => t.dataset.k);
      if (!wiz.name) return toast("Ton prénom d'abord 🙂");
      if (!wiz.sports.length) return toast("Choisis au moins un sport");
      renderWizard(2);
    };
  } else if (step === 2) {
    app.innerHTML = `<div class="wiz"><div class="dots">${dots}</div><h1>${esc(wiz.name)}, c'est quoi ton objectif&nbsp;?</h1>
      <div class="tiles">${Object.entries(GOALS).map(([k, v]) => `<button type="button" class="tile ${wiz.goal.type === k ? "on" : ""}" data-k="${k}"><span>${GOAL_ICONS[k]}</span>${v}</button>`).join("")}</div>
      <div class="grid2" style="margin-top:12px"><div><label for="goalName">Son nom (facultatif)</label><input id="goalName" value="${esc(wiz.goal.name || "")}" placeholder="Ex. Ironman de Nice"></div>
      <div><label for="goalDate">La date</label><input id="goalDate" type="date" value="${esc(wiz.goal.date || "")}"></div></div>
      ${nav()}</div>`;
    for (const t of document.querySelectorAll(".tile")) t.onclick = () => { document.querySelectorAll(".tile").forEach((x) => x.classList.remove("on")); t.classList.add("on"); };
    $("#back").onclick = () => renderWizard(1);
    $("#nextStep").onclick = () => {
      const t = document.querySelector(".tile.on");
      if (!t) return toast("Choisis un objectif");
      wiz.goal = { ...wiz.goal, type: t.dataset.k, name: $("#goalName").value, date: $("#goalDate").value };
      renderWizard(3);
    };
  } else if (step === 3) {
    app.innerHTML = `<div class="wiz"><div class="dots">${dots}</div><h1>Pour affiner</h1><p class="sub">Tout est facultatif, tu pourras compléter plus tard.</p>
      <div class="grid2">
        <div><label for="tw">Poids visé (kg)</label><input id="tw" type="number" step="0.1" inputmode="decimal" value="${esc(wiz.goal.targetWeight || "")}"></div>
        <div><label for="twd">Pour quand ?</label><input id="twd" type="date" value="${esc(wiz.goal.weightDate || "")}"></div>
        <div><label for="hours">Heures dispo par semaine</label><input id="hours" type="number" inputmode="decimal" value="${esc(wiz.hoursPerWeek || "")}" placeholder="Ex. 8"></div>
        <div><label for="sex">Sexe</label><select id="sex"><option value="m">Homme</option><option value="f" ${wiz.sex === "f" ? "selected" : ""}>Femme</option></select></div>
        <div><label for="hrMax">FC max</label><input id="hrMax" type="number" inputmode="numeric" value="${esc(wiz.hrMax || "")}" placeholder="Ex. 185"></div>
        <div><label for="hrRest">FC de repos</label><input id="hrRest" type="number" inputmode="numeric" value="${esc(wiz.hrRest || "")}" placeholder="Ex. 55"></div>
      </div>
      <label class="row" style="margin-top:16px"><input type="checkbox" id="vest" style="width:auto" ${wiz.vestiaire ? "checked" : ""}> Rejoindre le vestiaire (classement de la semaine entre potes)</label>
      ${me.aiAvailable ? `<label class="row"><input type="checkbox" id="ai" style="width:auto"> Activer le coach IA</label>` : ""}
      ${nav("C'est parti", true)}</div>`;
    const collect = () => Object.assign(wiz, { hoursPerWeek: $("#hours").value, sex: $("#sex").value, hrMax: $("#hrMax").value, hrRest: $("#hrRest").value, vestiaire: $("#vest").checked, aiEnabled: $("#ai")?.checked || false, goal: { ...wiz.goal, targetWeight: $("#tw").value, weightDate: $("#twd").value } });
    $("#back").onclick = () => { collect(); renderWizard(2); };
    const finish = async () => {
      collect();
      try {
        me = await api("/profile", { method: "POST", body: { profile: { ...wiz, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } } });
        renderWizard(4);
      } catch (e) { toast(e.message); }
    };
    $("#nextStep").onclick = finish; $("#skip").onclick = finish;
  } else {
    app.innerHTML = `<div class="wiz"><div class="dots">${dots}</div><h1>Dernière étape : branche ta montre</h1>
      <p class="sub">Plus l'appli a de données, plus ton point du matin est juste. Tu peux brancher les deux.</p>
      <a class="btn big conn-big" href="/api/coros/connect?region=eu"><span>⌚</span><div><b>Connecter COROS</b><small>Activités, VFC, sommeil, récupération</small></div></a>
      ${me.stravaAvailable ? `<a class="btn big conn-big strava" href="/api/strava/connect"><span>🟧</span><div><b>Se connecter avec Strava</b><small>Toutes tes activités, quelle que soit ta montre</small></div></a>` : ""}
      <button class="btn big conn-big" id="wizPhone"><span>📱</span><div><b>Apple Santé ou Android</b><small>Sommeil, VFC, FC de repos, poids, séances (Garmin, Apple Watch, Samsung…)</small></div></button>
      <p class="muted small">Montre Garmin ? Active la synchro Garmin vers Strava pour tes séances, et vers Apple Santé ou Health Connect pour le sommeil et le poids.</p>
      <button id="later" style="width:100%;margin-top:6px">Plus tard, voir mon point du jour</button></div>`;
    $("#wizPhone").onclick = () => { showTabs(); renderPhone(); };
    $("#later").onclick = () => { showTabs(); go("today"); };
  }
}

function renderProfile(first) {
  if (first) return renderWizard(1);
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
    <label class="row" style="margin-top:14px"><input type="checkbox" id="vest" style="width:auto" ${p.vestiaire ? "checked" : ""}> Rejoindre le vestiaire : classement de la semaine entre potes (seuls ton prénom, tes ressentis remplis et tes séances déclarées comptent)</label>
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
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, aiEnabled: $("#ai")?.checked || false, vestiaire: $("#vest").checked,
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
  ${levelStrip(d.game)}
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
  ${questsCard(d.game)}
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
  bindQuests();
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

// ---------- Gamification ----------
function levelStrip(g) {
  if (!g) return "";
  const L = g.level;
  return `<div class="card lvl" style="padding:12px 14px"><div class="num">${L.index}</div><div class="info">
    <div class="row" style="justify-content:space-between"><b>${esc(L.name)}</b><span class="muted">${nf(L.xp)} XP</span></div>
    <div class="xpbar"><i style="width:${L.progress}%"></i></div>
    <div class="muted" style="margin-top:4px">${L.next ? `Encore ${nf(L.toNext)} XP pour passer ${esc(L.next)}` : "Niveau max, respect."}${g.streaks.checkin > 1 ? ` · 🔥 ${g.streaks.checkin} jours d'affilée` : ""}</div></div></div>`;
}
function questsCard(g) {
  if (!g) return "";
  const done = g.quests.filter((q) => q.done).length;
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Quêtes du jour</h2><span class="muted">${done}/3${g.perfectToday ? " · journée parfaite ⭐" : ` · +${15} XP si tout est validé`}</span></div>
    <ul class="quests">${g.quests.map((q) => `<li class="${q.done ? "done" : ""}"><span class="check ${q.done ? "on" : ""}">${q.done ? "✓" : ""}</span>
      <span class="t">${esc(q.title)}</span>
      <span>${!q.done && q.manualLabel ? `<button data-quest="session">${esc(q.manualLabel)}</button>` : q.id === "session" && q.done && me.profile.vestiaire && !g.declared ? `<button data-quest="declare">Déclarer au vestiaire</button>` : `<span class="xp">+${q.xp} XP</span>`}</span></li>`).join("")}</ul>
    <p class="muted" style="margin-bottom:0">Défi de la semaine : ${nf(g.weekly.hours, 1)} h sur ${nf(g.weekly.target, 1)} h ${g.weekly.done ? "· réussi 💪" : `· ${g.weekly.daysLeft} j restants, +${g.weekly.xp} XP à la clé`}</p></div>`;
}
function bindQuests() {
  for (const b of document.querySelectorAll("[data-quest]")) b.onclick = async () => {
    b.disabled = true;
    try { await api("/quest", { method: "POST", body: { action: b.dataset.quest } }); data = null; go(view); }
    catch (e) { toast(e.message); b.disabled = false; }
  };
}
function celebrate(g) {
  if (!g || (!g.xpGained && !g.newly.length && !g.levelUp)) return;
  if (!g.newly.length && !g.levelUp) { toast(`+${g.xpGained} XP`); return; }
  const c = $("#celebrate");
  const b = g.newly[0];
  c.innerHTML = `<div class="box">${g.levelUp ? `<div class="big">🏆</div><h2>Niveau ${g.level.index} : ${esc(g.level.name)}</h2>` : `<div class="big">${b.icon}</div><h2>Badge débloqué : ${esc(b.name)}</h2>`}
    ${g.newly.length > (g.levelUp ? 0 : 1) ? `<p class="muted">${g.newly.slice(g.levelUp ? 0 : 1).map((x) => `${x.icon} ${esc(x.name)}`).join(" · ")}</p>` : ""}
    <div class="gain">+${g.xpGained} XP</div><button class="primary" id="celebrateOk">Allez !</button></div>`;
  c.hidden = false;
  const colors = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
  for (let i = 0; i < 40; i++) {
    const k = document.createElement("i");
    k.className = "confetti";
    k.style.left = Math.random() * 100 + "vw";
    k.style.background = colors[i % colors.length];
    k.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
    k.style.animationDelay = Math.random() * 0.4 + "s";
    document.body.appendChild(k);
    setTimeout(() => k.remove(), 3800);
  }
  $("#celebrateOk").onclick = () => (c.hidden = true);
}

async function renderGame() {
  app.innerHTML = `<p class="loading">…</p>`;
  let d; try { d = await loadPoint(); } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  if (view !== "game") return;
  const g = d.game;
  const earned = g.badges.filter((b) => b.earned).length;
  const LEVELS = [["Licence en poche", 0], ["Sprinteur", 150], ["Olympique", 400], ["Half", 800], ["Ironman", 1500], ["Finisher", 2500], ["Ultra", 4000], ["Légende", 6000]];
  app.innerHTML = `
  <h1>Défis</h1>
  ${levelStrip(g)}
  <div class="kpis">
    <div class="kpi"><span>Ressentis d'affilée</span><b>🔥 ${g.streaks.checkin}</b><small>jours</small></div>
    <div class="kpi"><span>Journées parfaites</span><b>⭐ ${g.streaks.perfect}</b><small>3 quêtes sur 3</small></div>
    <div class="kpi"><span>Semaines régulières</span><b>🧱 ${g.streaks.regularWeeks}</b><small>3 séances ou plus</small></div>
    <div class="kpi"><span>Badges</span><b>🏅 ${earned}</b><small>sur ${g.badges.length}</small></div>
  </div>
  <div class="card"><h2>Défi de la semaine</h2>
    <p class="sub">${nf(g.weekly.target, 1)} h d'entraînement d'ici dimanche (80 % de ta dispo déclarée).</p>
    <div class="xpbar" style="height:12px"><i style="width:${Math.min(100, Math.round((g.weekly.hours / g.weekly.target) * 100))}%"></i></div>
    <p class="muted">${nf(g.weekly.hours, 1)} h faites${g.weekly.done ? " · défi réussi, +100 XP" : ` · ${g.weekly.daysLeft} jours restants`}</p></div>
  <div class="card"><h2>Le vestiaire</h2><div id="board"><p class="muted">…</p></div></div>
  <div class="card"><h2>Badges</h2><div class="badges">${g.badges.map((b) => `<div class="bdg ${b.earned ? "" : "off"}" title="${esc(b.desc)}"><span class="e">${b.icon}</span><b>${esc(b.name)}</b><small>${b.earned ? new Date(b.earned + "T12:00:00").toLocaleDateString("fr-FR") : esc(b.desc)}</small></div>`).join("")}</div></div>
  <div class="card"><h2>Les niveaux</h2><ul class="ladder">${LEVELS.map(([n, x], i) => `<li class="${i + 1 === g.level.index ? "cur" : i + 1 < g.level.index ? "ok" : ""}"><span>${i + 1}. ${n}</span><span>${nf(x)} XP</span></li>`).join("")}</ul>
    <p class="muted">Ressenti +20 XP, séance du jour +40, quête bonus +15, journée parfaite +15, défi de la semaine +100, chaque badge +50.</p></div>`;
  try {
    const v = await api("/vestiaire");
    if (view !== "game") return;
    $("#board").innerHTML = !v.enabled
      ? `<p class="muted">Rejoins le vestiaire depuis ton profil pour te mesurer à tes potes chaque semaine. Seuls ton prénom, tes ressentis remplis (10 pts) et tes séances déclarées (20 pts) sont partagés.</p><button id="joinV">Modifier mon profil</button>`
      : v.members.length < 2 ? `<p class="muted">Tu es seul pour l'instant. Partage le lien et le code d'invitation à tes potes.</p>${board(v.members)}` : board(v.members);
    $("#joinV")?.addEventListener("click", () => renderProfile(false));
  } catch (e) { $("#board").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
function board(members) {
  const medal = ["🥇", "🥈", "🥉"];
  return `<ul class="board">${members.map((m, i) => `<li class="${m.me ? "me" : ""}"><span class="rk">${medal[i] || i + 1}</span><span>${esc(m.name)}${m.me ? " (toi)" : ""}</span><span class="muted">🔥 ${m.streak}</span><b>${m.points} pts</b></li>`).join("")}</ul>
    <p class="muted">Classement de la semaine, remis à zéro chaque lundi.</p>`;
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

// ---------- Apple Santé / Android ----------
async function renderPhone(tab) {
  view = "settings";
  app.innerHTML = `<p class="loading">…</p>`;
  let info;
  try { info = await api("/phone"); } catch (e) { app.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const isAndroid = tab ? tab === "android" : /android/i.test(navigator.userAgent);
  app.innerHTML = `
  <h1>Apple Santé et Android</h1>
  <p class="sub">Ni Apple ni Google ne laissent un site lire tes données santé directement. C'est donc ton téléphone qui les envoie, une fois par jour, vers ton adresse personnelle ci-dessous. Garmin, Apple Watch, Samsung, Withings, Polar… tout ce qui remonte dans Santé ou Health Connect en profite.</p>
  <div class="card"><h2>Ton adresse personnelle</h2>
    <p class="muted">Elle est secrète : ne la partage pas, c'est elle qui identifie ton compte.</p>
    <div class="code small-code" id="phoneUrl">${esc(info.url)}</div>
    <div class="split"><button id="copyUrl" class="primary">Copier l'adresse</button><button id="resetUrl">Changer d'adresse</button></div>
    <p class="muted">${info.lastSync ? `Dernière réception : ${new Date(info.lastSync).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })} · ${info.days} jours, ${info.workouts} séances` : "Rien reçu pour l'instant."}</p></div>
  <div class="seg"><button id="tabIos" class="${isAndroid ? "" : "on"}">iPhone</button><button id="tabAndroid" class="${isAndroid ? "on" : ""}">Android</button></div>
  ${isAndroid ? `
  <div class="card"><h2>Android : Health Connect</h2><ol class="howto">
    <li>Vérifie que ta montre ou ton appli (Garmin Connect, Samsung Health, Fitbit, Google Fit…) envoie bien ses données dans <b>Health Connect</b> (dans ses réglages, cherche « Health Connect »).</li>
    <li>Installe l'appli gratuite et open source <b>HC Webhook</b> depuis le Play Store (com.hcwebhook.app).</li>
    <li>Dans HC Webhook, ouvre « Data types » et coche : Sommeil, Variabilité de la fréquence cardiaque, Fréquence cardiaque au repos, Poids, Pas, Exercice. Accepte les autorisations Health Connect.</li>
    <li>Dans « Webhooks », ajoute une adresse et colle ton adresse personnelle. Format : JSON.</li>
    <li>Règle la synchro programmée, par exemple toutes les heures ou à 7 h chaque matin.</li>
    <li>Appuie sur « Sync now » une première fois, puis reviens ici : la date de dernière réception doit s'afficher.</li>
  </ol></div>` : `
  <div class="card"><h2>iPhone : un raccourci gratuit</h2>
    <p class="muted">On utilise l'app Raccourcis d'Apple, déjà installée. Compte 5 minutes la première fois. Les noms des actions peuvent varier un peu selon ta version d'iOS.</p>
    <ol class="howto">
      <li>Ouvre <b>Raccourcis</b>, onglet <b>Automatisation</b>, puis <b>+</b> et <b>Heure de la journée</b>. Choisis 7 h 30, tous les jours, et « Exécuter immédiatement ».</li>
      <li>Ajoute l'action <b>Rechercher des échantillons de santé</b> : type « Variabilité de la fréquence cardiaque », date de début « dans les 12 dernières heures ». Ajoute ensuite <b>Calculer des statistiques</b> → Moyenne.</li>
      <li>Ajoute de la même façon <b>Fréquence cardiaque au repos</b> (dernières 24 h, limite 1, tri du plus récent), et <b>Poids</b> (dernières 24 h, limite 1).</li>
      <li>Pour le sommeil : <b>Rechercher des échantillons de santé</b> type « Analyse du sommeil », valeur « Endormi », dernières 12 h. Puis <b>Obtenir les détails des échantillons</b> → Durée, et <b>Calculer des statistiques</b> → Somme (en minutes).</li>
      <li>Termine par <b>Obtenir le contenu de l'URL</b> : colle ton adresse, méthode <b>POST</b>, corps de requête <b>JSON</b> avec ces champs : <code>hrv</code>, <code>restingHr</code>, <code>weight</code>, <code>sleepMinutes</code> (chacun relié au résultat correspondant).</li>
      <li>Lance le raccourci une fois à la main et reviens ici : la date de dernière réception doit s'afficher.</li>
    </ol>
    <p class="muted">Tu préfères une appli toute faite ? « Health Webhook » sur l'App Store (payante, du même auteur que l'appli Android) devrait marcher avec la même adresse, mais je ne l'ai pas encore testée.</p></div>`}
  <div class="card"><h2>Ce qui est utilisé</h2><p class="muted">VFC de la nuit, sommeil, FC de repos et poids alimentent ta note du matin et tes courbes. Les séances du téléphone s'ajoutent à ta charge, sans doublon avec Strava ou COROS. Si tu as aussi COROS, ce sont les chiffres COROS qui passent en premier.</p>
    ${info.lastSync ? `<button class="danger" id="phoneOff">Arrêter et effacer les données du téléphone</button>` : ""}</div>
  <button id="backSettings" style="width:100%">Retour aux réglages</button>`;
  $("#copyUrl").onclick = () => navigator.clipboard?.writeText(info.url).then(() => toast("Adresse copiée"));
  $("#resetUrl").onclick = async () => { if (!confirm("L'ancienne adresse ne marchera plus. Continuer ?")) return; await api("/phone?reset=1"); renderPhone(tab); };
  $("#tabIos").onclick = () => renderPhone("ios");
  $("#tabAndroid").onclick = () => renderPhone("android");
  $("#phoneOff")?.addEventListener("click", async () => { me = await api("/phone/disconnect", { method: "POST" }); data = null; renderSettings(); });
  $("#backSettings").onclick = () => go("settings");
}

// ---------- Réglages ----------
async function renderSettings() {
  if (!demo) { try { me = await api("/me"); } catch { /* on garde l'état connu */ } }
  app.innerHTML = `
  <h1>Réglages</h1>
  <div class="card"><h2>Mes applis</h2>
    <div class="conn"><div><b>Strava</b><br><span class="muted">${me.strava.connected ? `<span class="ok">Connecté</span>${me.strava.firstname ? " · " + esc(me.strava.firstname) : ""}` : "Activités, durées, fréquence cardiaque"}</span></div>
      ${me.strava.connected ? `<button id="stravaOff">Déconnecter</button>` : me.stravaAvailable ? `<a class="btn strava" href="/api/strava/connect">Se connecter avec Strava</a>` : `<span class="muted">Non configuré</span>`}</div>
    <div class="conn"><div><b>COROS</b><br><span class="muted">${me.coros.connected ? `<span class="ok">Connecté</span> · région ${esc(me.coros.region.toUpperCase())}` : "Activités, VFC, sommeil, récupération"}</span></div>
      ${me.coros.connected ? `<button id="corosOff">Déconnecter</button>` : `<div class="row"><select id="region" style="width:auto"><option value="eu">Europe</option><option value="us">États-Unis</option><option value="cn">Chine</option></select><button class="primary" id="corosOn">Connecter</button></div>`}</div>
    <div class="conn"><div><b>Apple Santé / Android</b><br><span class="muted">${me.phone.connected ? `<span class="ok">Reçu</span> · dernière synchro ${new Date(me.phone.lastSync).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : "Sommeil, VFC, FC repos, poids, séances du téléphone"}</span></div>
      <button id="phoneCfg">${me.phone.connected ? "Gérer" : "Configurer"}</button></div>
    <div class="conn"><div><b>Garmin</b><br><span class="muted">Garmin a mis en pause l'accès des applis tierces. En attendant : synchro Garmin → Strava pour les séances, et Garmin → Apple Santé ou Health Connect pour le reste.</span></div><span class="muted">Via Strava / téléphone</span></div>
    <p class="muted">Chacun connecte ses propres comptes. Tes données ne sont visibles que par toi. Si ta montre COROS est déjà synchronisée avec Strava, les doublons sont fusionnés automatiquement.</p>
  </div>
  <div class="card"><h2>Profil et objectif</h2><p class="sub">${esc(me.profile.name)} · ${esc(GOALS[me.profile.goal?.type] || "")} · ${me.profile.sports.map((s) => SPORTS[s]).join(", ")}</p><button id="editProfile">Modifier</button></div>
  <div class="card"><h2>Accès depuis un autre appareil</h2><p class="muted">Génère un nouveau code de récupération (l'ancien ne marchera plus).</p><button id="newCode">Nouveau code</button><div id="codeOut"></div></div>
  <div class="card"><h2>Mes données</h2>
    <div class="row"><a class="btn" href="/api/export">Exporter (JSON)</a><button id="logout">Me déconnecter</button><button class="danger" id="del">Supprimer mon compte</button></div>
    <p class="muted">Les activités Strava ne sont jamais stockées : elles sont lues à chaque ouverture. On garde seulement ton profil, tes saisies et des jetons de connexion chiffrés.</p></div>
  <div class="card flat"><p class="muted">Installer l'appli : sur iPhone, bouton Partager puis « Sur l'écran d'accueil ». Sur Android, menu ⋮ puis « Installer l'application ».</p></div>`;
  $("#editProfile").onclick = () => renderProfile(false);
  $("#phoneCfg").onclick = () => renderPhone();
  if (demo) for (const a of app.querySelectorAll("a.btn")) a.onclick = (e) => { e.preventDefault(); toast("En démo, rien à connecter : crée ton espace pour de vrai !"); };
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
