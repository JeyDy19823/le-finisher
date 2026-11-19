// Gamification : quêtes du jour, XP, niveaux, séries, badges, défi de la semaine,
// et points « vestiaire » partagés entre amis.
//
// Règle Strava : les données d'activité d'un athlète ne peuvent être montrées qu'à lui.
// Tout ce qui est calculé à partir des séances (XP, badges, défi hebdo) reste donc privé.
// Le classement du vestiaire ne compte que des déclarations faites à la main dans l'appli
// (ressenti du jour, séance déclarée).

import { addDays, daysBetween } from "./engine.mjs";

export const XP = { checkin: 20, session: 40, bonus: 15, perfect: 15, week: 100, badge: 50 };

export const LEVELS = [
  { xp: 0, name: "Licence en poche" },
  { xp: 150, name: "Sprinteur" },
  { xp: 400, name: "Olympique" },
  { xp: 800, name: "Half" },
  { xp: 1500, name: "Ironman" },
  { xp: 2500, name: "Finisher" },
  { xp: 4000, name: "Ultra" },
  { xp: 6000, name: "Légende" },
];

export const BADGES = [
  { id: "premier-pas", icon: "👟", name: "Premier pas", desc: "Remplir ton premier ressenti" },
  { id: "serie-7", icon: "🔥", name: "Une semaine sans lâcher", desc: "7 jours de ressenti d'affilée" },
  { id: "serie-30", icon: "☄️", name: "Mental d'acier", desc: "30 jours de ressenti d'affilée" },
  { id: "parfait", icon: "⭐", name: "Journée parfaite", desc: "Valider les 3 quêtes du jour" },
  { id: "parfait-10", icon: "🌟", name: "Perfectionniste", desc: "10 journées parfaites" },
  { id: "sage", icon: "🧘", name: "Le sage", desc: "Respecter un feu rouge et récupérer" },
  { id: "triathlete", icon: "🔱", name: "Triathlète", desc: "Nager, rouler et courir dans la même semaine" },
  { id: "hyrox", icon: "🏋️", name: "Bête de Hyrox", desc: "5 séances CrossFit / Hyrox en 30 jours" },
  { id: "leve-tot", icon: "🌅", name: "Lève-tôt", desc: "Une séance commencée avant 7 h" },
  { id: "noctambule", icon: "🌙", name: "Noctambule", desc: "Une séance commencée après 21 h" },
  { id: "semi", icon: "🥈", name: "Semi", desc: "Courir 21,1 km d'un coup" },
  { id: "marathon", icon: "🥇", name: "Marathonien", desc: "Courir 42,2 km d'un coup" },
  { id: "centurion", icon: "💯", name: "Centurion", desc: "Une sortie vélo de 100 km" },
  { id: "poisson", icon: "🐟", name: "Poisson", desc: "Nager 3 km d'un coup" },
  { id: "longue", icon: "⏳", name: "Endurant", desc: "Une séance de 3 h ou plus" },
  { id: "semaine-pleine", icon: "📅", name: "Semaine pleine", desc: "Réussir un défi de la semaine" },
  { id: "regulier", icon: "🧱", name: "Régulier", desc: "4 semaines d'affilée avec 3 séances ou plus" },
  { id: "moins-1", icon: "⚖️", name: "Premier kilo", desc: "1 kg de moins que ta première pesée" },
  { id: "moins-3", icon: "📉", name: "Ça fond", desc: "3 kg de moins que ta première pesée" },
  { id: "cible", icon: "🎯", name: "Dans la cible", desc: "Atteindre ton poids visé" },
];

export function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1] || null;
  return {
    index: i + 1, name: cur.name, xp,
    next: next ? next.name : null,
    toNext: next ? next.xp - xp : 0,
    progress: next ? Math.round(((xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100,
  };
}

const monday = (iso) => addDays(iso, -((new Date(iso + "T12:00:00").getDay() + 6) % 7));

function sleepMinutes(s) {
  const m = String(s || "").match(/(\d+)h\s*(\d+)?/);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : 0;
}

export function checkinStreak(checkins, today) {
  let d = checkins[today] ? today : addDays(today, -1);
  let n = 0;
  while (checkins[d]) { n++; d = addDays(d, -1); }
  return n;
}

function regularWeeks(acts, today) {
  let n = 0;
  for (let w = 1; w < 20; w++) { // semaines terminées, de la plus récente à la plus ancienne
    const start = addDays(monday(today), -7 * w);
    const end = addDays(start, 6);
    if (acts.filter((a) => a.date >= start && a.date <= end).length >= 3) n++; else break;
  }
  return n;
}

// Quêtes du jour.
export function questsFor({ point, acts, checkins, health, profile, today, manual = {} }) {
  const ci = checkins[today] || {};
  const red = point.readiness.level === "rouge";
  const cats = point.proposals.map((p) => p.category);
  const todays = acts.filter((a) => a.date === today);
  const q = [];
  q.push({ id: "checkin", title: "Remplir ton ressenti du jour", xp: XP.checkin, done: !!Object.keys(ci).length, auto: true });
  if (red) {
    q.push({ id: "session", title: "Feu rouge : repos ou 45 min max tout en douceur", xp: XP.session, done: !!manual.session, auto: false, manualLabel: "J'ai respecté" });
  } else {
    const hit = todays.find((a) => cats.includes(a.category) && a.durationMin >= 20);
    q.push({ id: "session", title: `Faire une des séances proposées (${point.proposals.map((p) => p.title.split(" :")[0]).join(" ou ")})`, xp: XP.session, done: !!hit || !!manual.session, auto: !!hit, manualLabel: "Je l'ai faite" });
  }
  // Quête bonus qui tourne selon le jour et les données disponibles.
  const options = [];
  if (profile.goal?.targetWeight) options.push({ id: "bonus", kind: "pesee", title: "Te peser ce matin", done: !!ci.weight });
  if (health && health.sleep) options.push({ id: "bonus", kind: "sommeil", title: "Dormir 7 h ou plus", done: sleepMinutes(health.sleep.duration) >= 420 });
  options.push({ id: "bonus", kind: "note", title: "Écrire une note dans ton ressenti", done: !!ci.note });
  const dow = new Date(today + "T12:00:00").getDay();
  q.push({ ...options[dow % options.length], xp: XP.bonus, auto: true });
  return q;
}

// Met à jour l'état sauvegardé et calcule ce qu'on affiche.
export function updateGame({ game: prev, point, acts, checkins, health, profile, today }) {
  const game = { days: {}, badges: {}, weeks: {}, ...(prev || {}) };
  game.days = { ...game.days };
  game.badges = { ...game.badges };
  game.weeks = { ...game.weeks };
  const day = { ...(game.days[today] || {}) };
  const manual = day.manual || {};
  const quests = questsFor({ point, acts, checkins, health, profile, today, manual });
  const done = quests.filter((x) => x.done).map((x) => x.id);
  const prevDone = day.done || [];
  day.done = [...new Set([...prevDone, ...done])]; // une quête validée le reste
  day.red = point.readiness.level === "rouge" || !!day.red;
  game.days[today] = day;
  quests.forEach((x) => { if (day.done.includes(x.id)) x.done = true; });

  // Défi de la semaine : un volume horaire à tenir.
  const wk = monday(today);
  const target = Math.max(2, Math.round((Number(profile.hoursPerWeek) || 5) * 0.8 * 2) / 2);
  const hours = +(acts.filter((a) => a.date >= wk && a.date <= today).reduce((s, a) => s + a.durationMin, 0) / 60).toFixed(1);
  if (hours >= target) game.weeks[wk] = true;
  const weekly = { target, hours, done: !!game.weeks[wk], daysLeft: 6 - daysBetween(wk, today), xp: XP.week };

  // Séries.
  const days = Object.entries(game.days);
  const perfectDays = days.filter(([, d]) => (d.done || []).length >= 3).length;
  const streaks = {
    checkin: checkinStreak(checkins, today),
    perfect: perfectDays,
    regularWeeks: regularWeeks(acts, today),
  };

  // Badges (une fois gagné, un badge reste acquis).
  const recent = (n) => acts.filter((a) => daysBetween(a.date, today) >= 0 && daysBetween(a.date, today) < n);
  const weights = Object.entries(checkins).filter(([, c]) => c.weight).sort(([a], [b]) => (a < b ? -1 : 1));
  const firstW = weights.length ? Number(weights[0][1].weight) : null;
  const curW = point.weight.status ? point.weight.status.current : weights.length ? Number(weights[weights.length - 1][1].weight) : null;
  const tests = {
    "premier-pas": Object.keys(checkins).length > 0,
    "serie-7": streaks.checkin >= 7,
    "serie-30": streaks.checkin >= 30,
    parfait: perfectDays >= 1,
    "parfait-10": perfectDays >= 10,
    sage: days.some(([, d]) => d.red && (d.done || []).includes("session")),
    triathlete: ["swim", "bike", "run"].every((c) => recent(7).some((a) => a.category === c)),
    hyrox: recent(30).filter((a) => a.category === "hybrid").length >= 5,
    "leve-tot": acts.some((a) => a.hour != null && a.hour < 7),
    noctambule: acts.some((a) => a.hour != null && a.hour >= 21),
    semi: acts.some((a) => a.category === "run" && a.distanceKm >= 21.1),
    marathon: acts.some((a) => a.category === "run" && a.distanceKm >= 42.2),
    centurion: acts.some((a) => a.category === "bike" && a.distanceKm >= 100),
    poisson: acts.some((a) => a.category === "swim" && a.distanceKm >= 3),
    longue: acts.some((a) => a.durationMin >= 180),
    "semaine-pleine": Object.keys(game.weeks).length > 0,
    regulier: streaks.regularWeeks >= 4,
    "moins-1": firstW && curW && firstW - curW >= 1,
    "moins-3": firstW && curW && firstW - curW >= 3,
    cible: profile.goal?.targetWeight && curW && curW <= Number(profile.goal.targetWeight),
  };
  const newly = [];
  for (const b of BADGES) if (tests[b.id] && !game.badges[b.id]) { game.badges[b.id] = today; newly.push(b); }

  // XP total.
  const questXp = { checkin: XP.checkin, session: XP.session, bonus: XP.bonus };
  const xp = days.reduce((s, [, d]) => s + (d.done || []).reduce((t, id) => t + (questXp[id] || 0), 0) + ((d.done || []).length >= 3 ? XP.perfect : 0), 0)
    + Object.keys(game.weeks).length * XP.week
    + Object.keys(game.badges).length * XP.badge;
  const prevXp = prev?.xp || 0;
  game.xp = xp;

  return {
    state: game,
    view: {
      level: levelFor(xp),
      quests,
      perfectToday: day.done.length >= 3,
      declared: !!manual.declared,
      weekly,
      streaks,
      badges: BADGES.map((b) => ({ ...b, earned: game.badges[b.id] || null })),
      newly: newly.map((b) => ({ id: b.id, icon: b.icon, name: b.name })),
      xpGained: Math.max(0, xp - prevXp),
      levelUp: levelFor(xp).index > levelFor(prevXp).index && !!prev,
    },
  };
}

// Points du vestiaire de la semaine : uniquement du déclaratif.
export function vestiairePoints(user, today) {
  const wk = monday(today);
  let pts = 0;
  for (const [date, c] of Object.entries(user.checkins || {})) if (date >= wk && date <= today && Object.keys(c).length) pts += 10;
  for (const [date, d] of Object.entries(user.game?.days || {})) if (date >= wk && date <= today && d.manual?.declared) pts += 20;
  return { points: pts, streak: checkinStreak(user.checkins || {}, today) };
}
