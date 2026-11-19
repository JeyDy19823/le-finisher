// Moteur de calcul : charge d'entraînement, forme (PMC), état de forme du jour,
// propositions de séances et indicateurs des tableaux de bord.
// Aucune dépendance, aucun appel réseau : tout est déterministe et testable.
//
// Sources des formules (sourcées sur GitHub) :
// - CTL/ATL/TSB : modèle de Banister / Performance Manager Chart, tel qu'implémenté
//   dans FitOps-CLI, TrainingPulse (mkuf/TrainingPulse) et velomate (elduty/velomate).
// - TRIMP de Banister pondéré par le sexe, ramené à une échelle type TSS
//   (1 h au seuil ≈ 100), comme le hrTSS de velomate.

export const SPORT_COLORS = {
  run: "#3987e5", bike: "#d95926", swim: "#199e70", hybrid: "#c98500", other: "#d55181",
};
export const SPORT_LABELS = {
  run: "Course", bike: "Vélo", swim: "Natation", hybrid: "CrossFit / Hyrox / renfo", other: "Autre",
};

const DAY = 86400000;

export function isoDay(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

// ---------- Catégories de sport ----------
export function categoryFromStrava(type) {
  const t = String(type || "");
  if (/Run|Walk|Hike/.test(t)) return /Walk|Hike/.test(t) ? "other" : "run";
  if (/Ride|Cycl|Velomobile|Handcycle/.test(t)) return "bike";
  if (/Swim/.test(t)) return "swim";
  if (/Crossfit|WeightTraining|Workout|HighIntensity|Rowing|Elliptical|StairStepper|Boxing/.test(t)) return "hybrid";
  return "other";
}
export function categoryFromCoros(code) {
  const c = Number(code);
  if ([100, 101, 102, 103].includes(c)) return "run";
  if (c >= 200 && c < 300) return "bike";
  if (c === 300 || c === 301) return "swim";
  if ([400, 401, 402, 700, 701, 901, 902, 903, 906, 1200, 9901].includes(c)) return "hybrid";
  return "other";
}

// ---------- Charge d'une séance ----------
// Facteurs d'intensité par défaut quand il n'y a pas de fréquence cardiaque.
const DEFAULT_LOAD_PER_HOUR = { run: 65, bike: 55, swim: 60, hybrid: 60, other: 30 };

export function trimp(durationMin, avgHr, hrMax, hrRest, sex = "m") {
  const hrr = (avgHr - hrRest) / (hrMax - hrRest);
  if (!(hrr > 0) || !(hrr < 1.2)) return null;
  const k = sex === "f" ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr);
  return durationMin * hrr * k;
}

export function activityLoad(a, profile = {}) {
  const hrMax = Number(profile.hrMax) || 185;
  const hrRest = Number(profile.hrRest) || 55;
  const sex = profile.sex === "f" ? "f" : "m";
  if (a.avgHr && a.durationMin) {
    const t = trimp(a.durationMin, a.avgHr, hrMax, hrRest, sex);
    // TRIMP d'1 h au seuil (≈ 88 % de la FC de réserve) = 100 points.
    const ref = trimp(60, hrRest + 0.88 * (hrMax - hrRest), hrMax, hrRest, sex);
    if (t != null && ref) return Math.round((t / ref) * 100);
  }
  return Math.round(((a.durationMin || 0) / 60) * (DEFAULT_LOAD_PER_HOUR[a.category] || 30));
}

// ---------- Normalisation et dédoublonnage ----------
export function normalizeStrava(s) {
  return {
    id: `strava-${s.id}`,
    source: "strava",
    url: `https://www.strava.com/activities/${s.id}`,
    name: s.name || "",
    date: String(s.start_date_local || s.start_date).slice(0, 10),
    start: Date.parse(s.start_date) || Date.parse(s.start_date_local),
    category: categoryFromStrava(s.sport_type || s.type),
    durationMin: Math.round((s.moving_time || s.elapsed_time || 0) / 60),
    distanceKm: s.distance ? Math.round(s.distance / 10) / 100 : 0,
    avgHr: s.has_heartrate && s.average_heartrate ? Math.round(s.average_heartrate) : null,
    elevation: s.total_elevation_gain || 0,
    hour: Number(String(s.start_date_local || "").slice(11, 13)) || null,
  };
}

// Supprime les doublons : même catégorie et créneaux qui se chevauchent
// (ex. Zwift + home trainer enregistrés en même temps, ou COROS synchronisé vers Strava).
// On garde la séance avec FC, sinon la plus longue ; COROS passe avant Strava à égalité.
export function dedupe(list) {
  const sorted = [...list].sort((a, b) => (a.start || 0) - (b.start || 0));
  const kept = [];
  const score = (x) => (x.avgHr ? 1000000 : 0) + (x.durationMin || 0) * 10 + (x.source === "coros" ? 1 : 0);
  for (const a of sorted) {
    const aEnd = (a.start || 0) + (a.durationMin || 0) * 60000;
    const clash = kept.findIndex((k) => {
      if (k.category !== a.category || !a.start || !k.start) return false;
      const kEnd = k.start + k.durationMin * 60000;
      const overlap = Math.min(aEnd, kEnd) - Math.max(a.start, k.start);
      return overlap > 0.5 * Math.min(a.durationMin, k.durationMin) * 60000 || Math.abs(a.start - k.start) < 10 * 60000;
    });
    if (clash === -1) kept.push(a);
    else if (score(a) > score(kept[clash])) kept[clash] = { ...a, url: a.url || kept[clash].url };
  }
  return kept;
}

// ---------- Courbe de forme (CTL / ATL / TSB) ----------
export function dailyLoads(activities, profile, from, to) {
  const map = {};
  for (let d = from; d <= to; d = addDays(d, 1)) map[d] = 0;
  for (const a of activities) {
    if (a.date >= from && a.date <= to) map[a.date] += activityLoad(a, profile);
  }
  return map;
}

export function pmc(activities, profile, today, days = 120) {
  const from = addDays(today, -days);
  const loads = dailyLoads(activities, profile, from, today);
  const kCtl = 1 - Math.exp(-1 / 42);
  const kAtl = 1 - Math.exp(-1 / 7);
  let ctl = 0, atl = 0;
  const out = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const tsb = ctl - atl; // la forme du jour se lit sur la veille
    ctl += (loads[d] - ctl) * kCtl;
    atl += (loads[d] - atl) * kAtl;
    out.push({ date: d, load: loads[d], ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +tsb.toFixed(1) });
  }
  return out;
}

// ---------- Objectif et phase ----------
export const GOALS = {
  ironman: { label: "Ironman / triathlon XXL", endurance: true, sports: ["swim", "bike", "run"] },
  triathlon: { label: "Triathlon (S, M, 70.3)", endurance: true, sports: ["swim", "bike", "run"] },
  marathon: { label: "Marathon / semi", endurance: true, sports: ["run"] },
  trail: { label: "Trail", endurance: true, sports: ["run"] },
  hyrox: { label: "Hyrox / CrossFit", endurance: false, sports: ["hybrid", "run"] },
  weight: { label: "Perte de poids", endurance: false, sports: [] },
  fitness: { label: "Forme générale", endurance: false, sports: [] },
};

export function goalPhase(goal, today) {
  if (!goal || !goal.date) return { key: "continu", label: "Entretien", weeksLeft: null, daysLeft: null };
  const daysLeft = daysBetween(today, goal.date);
  const weeksLeft = Math.ceil(daysLeft / 7);
  if (daysLeft < 0) return { key: "post", label: "Après l'objectif", weeksLeft, daysLeft };
  if (daysLeft <= 7) return { key: "course", label: "Semaine de l'objectif", weeksLeft, daysLeft };
  if (weeksLeft <= 3) return { key: "affutage", label: "Affûtage", weeksLeft, daysLeft };
  if (weeksLeft <= 8) return { key: "specifique", label: "Préparation spécifique", weeksLeft, daysLeft };
  if (weeksLeft <= 16) return { key: "developpement", label: "Développement", weeksLeft, daysLeft };
  return { key: "foncier", label: "Foncier", weeksLeft, daysLeft };
}

// ---------- Poids ----------
export function weightTrend(checkins, profile, today) {
  const pts = Object.entries(checkins || {})
    .filter(([, c]) => c && Number(c.weight) > 0)
    .map(([date, c]) => ({ date, weight: Number(c.weight) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const smooth = pts.map((p) => {
    const win = pts.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < 7);
    return { ...p, avg7: +(win.reduce((s, q) => s + q.weight, 0) / win.length).toFixed(1) };
  });
  const goal = profile.goal || {};
  const target = Number(goal.targetWeight) || null;
  const last = smooth[smooth.length - 1] || null;
  let status = null;
  if (last && target) {
    const weekAgo = smooth.filter((p) => daysBetween(p.date, last.date) >= 6 && daysBetween(p.date, last.date) <= 14).pop();
    const ratePerWeek = weekAgo ? +((last.avg7 - weekAgo.avg7) / (daysBetween(weekAgo.date, last.date) / 7)).toFixed(2) : null;
    const deadline = goal.weightDate || goal.date;
    const weeks = deadline ? Math.max(daysBetween(today, deadline) / 7, 0.1) : null;
    const needed = weeks ? +((target - last.avg7) / weeks).toFixed(2) : null;
    status = { current: last.avg7, target, toGo: +(last.avg7 - target).toFixed(1), ratePerWeek, neededPerWeek: needed, deadline };
  }
  return { points: smooth, status };
}

// ---------- État de forme du jour ----------
function tsbScore(tsb) {
  if (tsb == null) return null;
  if (tsb >= 15) return 85; // très frais, voire désentraîné
  if (tsb >= 5) return 95;
  if (tsb >= -10) return 80;
  if (tsb >= -20) return 60;
  if (tsb >= -30) return 40;
  return 25;
}

export function readiness({ tsb, health = {}, checkin = {}, shortHistory = false }) {
  const parts = [];
  const add = (key, label, score, weight, detail) => {
    if (score != null && !Number.isNaN(score)) parts.push({ key, label, score: Math.round(score), weight, detail });
  };
  add("tsb", "Fraîcheur (charge)", tsbScore(tsb), shortHistory ? 1 : 3, tsb != null ? `Forme ${tsb > 0 ? "+" : ""}${Math.round(tsb)}` : "");
  if (health.hrv && health.hrv.value) {
    const { value, low, high, evaluation } = health.hrv;
    let s = 80;
    if (low && value < low) s = 35;
    else if (high && value > high) s = 75;
    else if (low && high) s = 70 + 30 * Math.min(1, (value - low) / Math.max(1, (high - low) / 2));
    add("hrv", "VFC de la nuit", s, 3, `${value} ms${evaluation ? ` (${evaluation})` : ""}`);
  }
  if (health.sleep && health.sleep.score > 0) add("sleep", "Sommeil", health.sleep.score, 2, `${health.sleep.score}/100, ${health.sleep.duration || ""}`.trim());
  else if (checkin.sleep) add("sleep", "Sommeil (ressenti)", (Number(checkin.sleep) - 1) * 25, 2, `${checkin.sleep}/5`);
  if (health.recovery && health.recovery.percent != null) add("recovery", "Récupération COROS", health.recovery.percent, 2, `${health.recovery.percent} %`);
  if (health.rhr && health.rhr.today && health.rhr.avg) {
    const delta = health.rhr.today - health.rhr.avg;
    add("rhr", "FC de repos", delta >= 7 ? 30 : delta >= 4 ? 55 : delta >= 2 ? 75 : 90, 1, `${health.rhr.today} bpm (moy. ${Math.round(health.rhr.avg)})`);
  }
  if (checkin.fatigue) add("fatigue", "Fatigue ressentie", 100 - (Number(checkin.fatigue) - 1) * 22, 2, `${checkin.fatigue}/5`);
  if (checkin.soreness) add("soreness", "Courbatures", 100 - (Number(checkin.soreness) - 1) * 20, 1, `${checkin.soreness}/5`);
  if (!parts.length) return { score: null, level: "inconnu", label: "Pas assez de données", parts };
  const w = parts.reduce((s, p) => s + p.weight, 0);
  let score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / w);
  // Un signal très mauvais plafonne la note, même si le reste est bon.
  const worst = Math.min(...parts.map((p) => p.score));
  if (worst < 40) score = Math.min(score, 64);
  const level = score >= 75 ? "vert" : score >= 55 ? "orange" : "rouge";
  const label = level === "vert" ? "Feu vert" : level === "orange" ? "À doser" : "Récupération";
  return { score, level, label, parts };
}

// ---------- Propositions de séances ----------
const SESSIONS = {
  run: {
    vert: { title: "Course : fractionné au seuil", duration: 60, detail: "20 min footing, 3 x 10 min allure seuil (Z4) récup 2 min, 10 min retour au calme." },
    vertLong: { title: "Course : sortie longue", duration: 100, detail: "1 h 40 en endurance fondamentale (Z2), 15 dernières min allure objectif." },
    orange: { title: "Course : footing + lignes droites", duration: 45, detail: "40 min en Z2, puis 6 x 20 s en accélération progressive." },
    rouge: { title: "Marche active ou footing très lent", duration: 30, detail: "30 min en Z1, sans montre si possible." },
  },
  bike: {
    vert: { title: "Vélo : sweet spot", duration: 75, detail: "15 min échauffement, 3 x 12 min à 88-93 % FTP récup 4 min, retour au calme." },
    vertLong: { title: "Vélo : sortie longue", duration: 180, detail: "3 h en Z2, ravitaillement toutes les 30 min (60-90 g de glucides/h)." },
    orange: { title: "Vélo : endurance souple", duration: 60, detail: "1 h en Z2 à vélocité haute (90-95 rpm)." },
    rouge: { title: "Vélo : décrassage", duration: 30, detail: "30 min en Z1, braquet léger." },
  },
  swim: {
    vert: { title: "Natation : seuil", duration: 60, detail: "400 échauffement, 10 x 100 allure seuil récup 15 s, 8 x 50 éducatifs, 200 souple." },
    vertLong: { title: "Natation : continu", duration: 60, detail: "2 x 1500 allure course, en eau libre si possible." },
    orange: { title: "Natation : technique", duration: 45, detail: "Éducatifs, pull-buoy, 1500 m tranquille en travaillant la glisse." },
    rouge: { title: "Natation : récupération", duration: 30, detail: "1000 m très souple, dos et brasse autorisés." },
  },
  hybrid: {
    vert: { title: "Hyrox : simulation", duration: 60, detail: "4 rounds : 1 km course + 1 station (SkiErg 1000 m, sled push, burpee broad jumps 80 m, wall balls 50). Allure course objectif." },
    vertLong: { title: "CrossFit : force + metcon", duration: 60, detail: "Back squat 5 x 5 à 75 %, puis AMRAP 15 min : 10 thrusters, 10 pull-ups, 200 m rameur." },
    orange: { title: "CrossFit : EMOM technique", duration: 45, detail: "EMOM 24 min : power clean léger, kettlebell swings, rameur 12 cal, gainage. Rester à 7/10 d'effort." },
    rouge: { title: "Mobilité et gainage", duration: 30, detail: "20 min de mobilité hanches / épaules, 10 min de gainage, respiration." },
  },
  other: {
    vert: { title: "Séance libre intense", duration: 60, detail: "Activité au choix avec 20 à 30 min d'effort soutenu." },
    vertLong: { title: "Sortie longue au choix", duration: 120, detail: "Randonnée, vélo ou course longue en endurance." },
    orange: { title: "Activité douce", duration: 45, detail: "Marche rapide, vélo tranquille ou natation souple." },
    rouge: { title: "Repos actif", duration: 30, detail: "Marche, étirements, sommeil en priorité." },
  },
};

export function proposals({ profile, readinessResult, activities, today, phase }) {
  const level = readinessResult.level === "inconnu" ? "orange" : readinessResult.level;
  const sports = (profile.sports && profile.sports.length ? profile.sports : ["run"]).filter((s) => SESSIONS[s]);
  const endurance = sports.filter((s) => ["swim", "bike", "run"].includes(s));
  const hybrid = sports.includes("hybrid");
  const week = activities.filter((a) => daysBetween(a.date, today) >= 0 && daysBetween(a.date, today) < 7);
  const minutes = (cat) => week.filter((a) => a.category === cat).reduce((s, a) => s + a.durationMin, 0);
  const yesterday = activities.filter((a) => a.date === addDays(today, -1));
  const doneToday = activities.filter((a) => a.date === today);
  const dow = new Date(today + "T12:00:00").getDay();
  const weekend = dow === 0 || dow === 6;
  const pickVariant = (cat) => {
    if (level === "rouge") return "rouge";
    if (level === "orange") return "orange";
    if (phase && (phase.key === "affutage" || phase.key === "course")) return "orange";
    if (weekend) return "vertLong";
    // Pas deux séances dures d'affilée dans la même discipline.
    if (yesterday.some((a) => a.category === cat && activityLoad(a, profile) > 80)) return "orange";
    return "vert";
  };
  const out = [];
  if (endurance.length) {
    // La discipline la moins travaillée sur 7 jours, en évitant celle d'hier.
    const ranked = [...endurance].sort((a, b) => minutes(a) - minutes(b));
    const cat = ranked.find((c) => !yesterday.some((a) => a.category === c)) || ranked[0];
    const v = pickVariant(cat);
    out.push({ axis: "Axe endurance / triathlon", category: cat, variant: v, ...SESSIONS[cat][v] });
  }
  if (hybrid) {
    const v = pickVariant("hybrid");
    out.push({ axis: "Axe CrossFit / Hyrox", category: "hybrid", variant: v, ...SESSIONS.hybrid[v] });
  }
  if (out.length < 2) {
    const alt = sports.find((s) => !out.some((o) => o.category === s)) || "other";
    const v = level === "vert" ? "orange" : "rouge";
    out.push({ axis: "Alternative", category: alt, variant: v, ...SESSIONS[alt][v] });
  }
  if (phase && phase.key === "course") {
    out.forEach((o) => { o.detail += " Semaine de l'objectif : rester court, quelques rappels d'allure, rien de nouveau."; });
  }
  return { proposals: out, alreadyDone: doneToday.map((a) => `${SPORT_LABELS[a.category]} ${a.durationMin} min`) };
}

// ---------- Synthèses pour les tableaux de bord ----------
export function weeklyVolume(activities, today, weeks = 12) {
  const dow = (new Date(today + "T12:00:00").getDay() + 6) % 7; // lundi = 0
  const monday = addDays(today, -dow);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(monday, -7 * i);
    const end = addDays(start, 6);
    const row = { week: start, run: 0, bike: 0, swim: 0, hybrid: 0, other: 0 };
    for (const a of activities) if (a.date >= start && a.date <= end) row[a.category] += a.durationMin / 60;
    for (const k of Object.keys(SPORT_COLORS)) row[k] = +row[k].toFixed(2);
    out.push(row);
  }
  return out;
}

export function calendar(activities, profile, today, days = 35) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const acts = activities.filter((a) => a.date === d);
    out.push({ date: d, load: acts.reduce((s, a) => s + activityLoad(a, profile), 0), count: acts.length, sports: [...new Set(acts.map((a) => a.category))] });
  }
  return out;
}

export function weekSummary(activities, profile, today) {
  const cur = activities.filter((a) => daysBetween(a.date, today) >= 0 && daysBetween(a.date, today) < 7);
  const prev = activities.filter((a) => daysBetween(a.date, today) >= 7 && daysBetween(a.date, today) < 14);
  const sum = (l) => ({
    hours: +(l.reduce((s, a) => s + a.durationMin, 0) / 60).toFixed(1),
    sessions: l.length,
    load: l.reduce((s, a) => s + activityLoad(a, profile), 0),
    km: Math.round(l.reduce((s, a) => s + (a.distanceKm || 0), 0)),
  });
  return { current: sum(cur), previous: sum(prev) };
}

// Point du jour complet.
export function dailyPoint({ profile, activities, health, checkins, today }) {
  const acts = dedupe(activities);
  const curve = pmc(acts, profile, today);
  const t = curve[curve.length - 1];
  const checkin = (checkins || {})[today] || {};
  const first = acts.reduce((m, a) => (a.date < m ? a.date : m), today);
  const historyDays = daysBetween(first, today);
  const r = readiness({ tsb: acts.length ? t.tsb : null, health, checkin, shortHistory: historyDays < 42 });
  const phase = goalPhase(profile.goal, today);
  const prop = proposals({ profile, readinessResult: r, activities: acts, today, phase });
  const weight = weightTrend(checkins, profile, today);
  const ratio = t.ctl > 1 ? +(t.atl / t.ctl).toFixed(2) : null;
  const alerts = [];
  if (historyDays < 42 && acts.length) alerts.push("Moins de 6 semaines d'historique : la courbe de forme se fiabilise avec le temps.");
  if (ratio && ratio > 1.5 && historyDays >= 42 && t.ctl >= 15) alerts.push("Charge aiguë très au-dessus de ta charge habituelle (ratio > 1,5) : risque de blessure, lève le pied 2 ou 3 jours.");
  if (health.hrv && health.hrv.low && health.hrv.value < health.hrv.low) alerts.push("VFC sous ta zone normale : privilégie une journée facile, hydrate-toi et couche-toi tôt.");
  if (weight.status && weight.status.neededPerWeek != null && weight.status.neededPerWeek < -1) alerts.push(`Pour tenir ton objectif de poids il faudrait perdre plus d'1 kg par semaine : vise plutôt 0,5 à 0,8 kg et décale l'échéance si besoin.`);
  return {
    today,
    readiness: r,
    load: { ctl: t.ctl, atl: t.atl, tsb: t.tsb, ratio },
    phase,
    ...prop,
    weight,
    week: weekSummary(acts, profile, today),
    alerts,
    dashboards: {
      pmc: curve.slice(-90),
      weekly: weeklyVolume(acts, today),
      calendar: calendar(acts, profile, today),
      recent: acts.filter((a) => daysBetween(a.date, today) < 14).sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, 12)
        .map((a) => ({ ...a, load: activityLoad(a, profile) })),
    },
  };
}
