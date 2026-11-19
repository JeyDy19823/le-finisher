import assert from "node:assert/strict";
import { updateGame, levelFor, vestiairePoints, checkinStreak } from "../netlify/functions/_lib/game.mjs";
import { dailyPoint, addDays } from "../netlify/functions/_lib/engine.mjs";
const today = "2026-11-19";
const profile = { sports: ["swim", "bike", "run", "hybrid"], hoursPerWeek: 8, goal: { type: "ironman", date: "2027-06-20", targetWeight: 85 } };
const acts = [
  { id: "a", source: "coros", date: "2026-11-17", start: 1, category: "swim", durationMin: 60, distanceKm: 3.2, hour: 6 },
  { id: "b", source: "coros", date: "2026-11-18", start: 2, category: "bike", durationMin: 240, distanceKm: 105 },
  { id: "c", source: "coros", date: today, start: 3, category: "run", durationMin: 50, distanceKm: 9, hour: 12 },
];
const checkins = {};
for (let i = 7; i >= 0; i--) checkins[addDays(today, -i)] = { fatigue: 2, weight: 90 - (7 - i) * 0.35 };
checkins[today].note = "bien";
assert.equal(checkinStreak(checkins, today), 8);
const point = dailyPoint({ profile, activities: acts, health: {}, checkins, today });
const r1 = updateGame({ game: null, point, acts, checkins, health: {}, profile, today });
const ids = r1.view.badges.filter((b) => b.earned).map((b) => b.id);
for (const id of ["premier-pas", "serie-7", "triathlete", "leve-tot", "centurion", "poisson", "longue", "moins-1"]) assert.ok(ids.includes(id), "badge manquant " + id);
assert.ok(!ids.includes("marathon"));
const q = Object.fromEntries(r1.view.quests.map((x) => [x.id, x.done]));
console.log("quêtes", r1.view.quests.map((x) => `${x.title} ${x.done ? "✓" : "·"}`));
assert.equal(q.checkin, true);
assert.ok(r1.view.level.xp > 0); assert.equal(r1.view.xpGained, r1.view.level.xp);
assert.equal(r1.view.levelUp, false, "pas de célébration de niveau au premier calcul");
// Deuxième appel : rien de nouveau, pas d'XP en double
const r2 = updateGame({ game: r1.state, point, acts, checkins, health: {}, profile, today });
assert.equal(r2.view.xpGained, 0); assert.equal(r2.view.newly.length, 0); assert.equal(r2.view.level.xp, r1.view.level.xp);
// Une séance qui disparaît de l'historique ne retire pas la quête validée
const r3 = updateGame({ game: r2.state, point, acts: acts.slice(0, 2), checkins, health: {}, profile, today });
assert.equal(r3.view.level.xp, r1.view.level.xp);
assert.equal(levelFor(0).name, "Licence en poche"); assert.equal(levelFor(1500).name, "Ironman"); assert.equal(levelFor(99999).toNext, 0);
// Vestiaire : seulement du déclaratif
const v = vestiairePoints({ checkins, game: { days: { [today]: { manual: { declared: true } }, "2026-11-10": { manual: { declared: true } } } } }, today);
assert.equal(v.points, 4 * 10 + 20, "lundi 16 → jeudi 19 = 4 ressentis + 1 séance déclarée cette semaine");
console.log("XP", r1.view.level, "badges", ids.length);
console.log("OK gamification");
