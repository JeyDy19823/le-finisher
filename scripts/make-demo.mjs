// Génère public/demo.json : un athlète fictif (« Alex ») avec 4 mois de données inventées,
// passées dans le vrai moteur. Sert au mode démo de la page d'accueil.
// Lancer : node scripts/make-demo.mjs
import fs from "node:fs";
import { dailyPoint, addDays, isoDay } from "../netlify/functions/_lib/engine.mjs";
import { updateGame } from "../netlify/functions/_lib/game.mjs";

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const today = isoDay(new Date());
const profile = {
  name: "Alex", sex: "m", sports: ["swim", "bike", "run", "hybrid"], hrMax: 186, hrRest: 52, hoursPerWeek: 9,
  tz: "Europe/Paris", aiEnabled: false, vestiaire: true,
  goal: { type: "ironman", name: "Ironman de Nice", date: addDays(today, 196), targetWeight: 78, weightDate: addDays(today, 70) },
};
const plan = { 1: ["swim", 55, 0], 2: ["run", 50, 0], 3: ["bike", 75, 0], 4: ["hybrid", 55, 0], 5: ["swim", 45, 0], 6: ["bike", 180, 1], 0: ["run", 95, 1] };
const acts = [];
for (let i = 120; i >= 0; i--) {
  const d = addDays(today, -i);
  const dow = new Date(d + "T12:00:00").getDay();
  if (i % 7 === 3 || rnd() < 0.08) continue; // jours de repos
  const [cat, dur0, long] = plan[dow];
  const ramp = 0.75 + 0.25 * (1 - i / 120);
  const dur = Math.round(dur0 * ramp * (0.85 + rnd() * 0.3));
  const hour = long ? 8 : rnd() < 0.3 ? 6 : 18;
  const speed = { swim: 2.6, run: 10.5, bike: 29, hybrid: 0 }[cat];
  acts.push({
    id: `demo-${i}`, source: "coros", url: null,
    name: { swim: "Natation piscine", run: long ? "Sortie longue" : "Footing", bike: long ? "Sortie vélo" : "Home trainer", hybrid: "Hyrox training" }[cat],
    date: d, start: new Date(d + `T${String(hour).padStart(2, "0")}:00:00`).getTime(), hour,
    category: cat, durationMin: dur, distanceKm: speed ? +(dur / 60 * speed).toFixed(1) : 0,
    avgHr: Math.round((cat === "hybrid" ? 140 : long ? 132 : 142) + rnd() * 10), elevation: 0,
  });
}
const checkins = {};
for (let i = 40; i >= 0; i--) {
  if (rnd() < 0.12 && i > 0) continue;
  checkins[addDays(today, -i)] = { weight: +(82.6 - (40 - i) * 0.07 + (rnd() - 0.5) * 0.6).toFixed(1), sleep: 3 + Math.round(rnd() * 2), fatigue: 1 + Math.round(rnd() * 2) };
}
checkins[today].note = "Bonnes jambes ce matin";
const hrvHistory = [], sleepHistory = [], rhrHistory = [];
for (let i = 6; i >= 0; i--) {
  const d = addDays(today, -i);
  hrvHistory.push({ date: d, value: Math.round(56 + rnd() * 14), low: 45, high: 78, baseline: 61, evaluation: "Normal" });
  sleepHistory.push({ date: d, score: Math.round(72 + rnd() * 20), duration: `${7 + Math.round(rnd())}h ${Math.round(rnd() * 50)}min` });
}
for (let i = 13; i >= 0; i--) rhrHistory.push({ date: addDays(today, -i), bpm: Math.round(50 + rnd() * 4) });
const health = {
  hrv: hrvHistory[hrvHistory.length - 1], hrvHistory,
  sleep: sleepHistory[sleepHistory.length - 1], sleepHistory,
  recovery: { percent: 88, level: "Fresh" },
  rhr: { today: 51, avg: 52 }, rhrHistory: rhrHistory.reverse(),
  corosLoad: [{ date: today, comment: "Optimized", shortTerm: 88, longTerm: 84, ratio: 1.05 }],
};
const point = dailyPoint({ profile, activities: acts, health, checkins, today });
let game = null;
for (let i = 30; i >= 1; i--) { // historique de jeu crédible
  const d = addDays(today, -i);
  game = game || { days: {}, badges: {}, weeks: {} };
  game.days[d] = { done: rnd() < 0.7 ? ["checkin", "session", "bonus"] : ["checkin", "session"], manual: { declared: rnd() < 0.6 } };
}
const g = updateGame({ game, point, acts, checkins, health, profile, today });
g.view.xpGained = 0; g.view.newly = []; g.view.levelUp = false;
const demo = {
  generatedFor: today,
  me: { id: "demo", profile, onboarded: true, strava: { connected: false }, coros: { connected: true, region: "eu" }, checkins, stravaAvailable: true, aiAvailable: false, inviteRequired: true },
  point: { point, game: g.view, health, errors: [], sources: { strava: false, coros: true } },
  vestiaire: { enabled: true, members: [
    { name: "Alex", me: true, points: 90, streak: 12 }, { name: "Sarah", points: 110, streak: 21 },
    { name: "Mehdi", points: 70, streak: 5 }, { name: "Julie", points: 60, streak: 9 }, { name: "Tom", points: 30, streak: 2 },
  ].sort((a, b) => b.points - a.points) },
};
fs.writeFileSync(new URL("../public/demo.json", import.meta.url), JSON.stringify(demo));
console.log("demo.json :", point.readiness.score, point.readiness.label, "| niveau", g.view.level.name, g.view.level.xp, "XP | badges", g.view.badges.filter((b) => b.earned).length);
