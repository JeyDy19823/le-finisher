import assert from "node:assert/strict";
import { parsePayload, mergePhone, phoneHealth, categoryFromExerciseType } from "../netlify/functions/_lib/phone.mjs";
import { addDays } from "../netlify/functions/_lib/engine.mjs";
const today = "2026-11-20";
// Format HC Webhook (Android), extrait de docs/webhook.md
const hc = {
  timestamp: "2026-11-20T07:05:00+01:00", app_version: "1.9.30", timezone: "Europe/Paris",
  sleep: [{ session_end_time: "2026-11-20T06:45:00+01:00", duration_seconds: 27000, stages: [{ stage: "AWAKE", duration_seconds: 1200 }, { stage: "DEEP", duration_seconds: 5000 }] }],
  heart_rate_variability: [{ time: "2026-11-20T03:00:00+01:00", rmssd_millis: 50 }, { time: "2026-11-20T05:00:00+01:00", avg: 60, min: 40, max: 80, rmssd_millis: 60 }, { time: "2026-11-20T15:00:00+01:00", rmssd_millis: 20 }],
  resting_heart_rate: [{ bpm: 52, time: "2026-11-20T06:00:00+01:00" }],
  weight: [{ kilograms: 84.26, time: "2026-11-20T07:00:00+01:00" }],
  steps: [{ count: 1200, start_time: "2026-11-20T06:50:00+01:00", end_time: "2026-11-20T07:00:00+01:00" }],
  exercise: [{ type: "EXERCISE_TYPE_RUNNING", start_time: "2026-11-19T18:00:00+01:00", end_time: "2026-11-19T18:50:00+01:00", duration_seconds: 3000, distance_meters: 9800, metadata: { id: "abc" } }],
};
const p = parsePayload(hc, "Europe/Paris");
assert.deepEqual(p.days[today], { sleepMin: 430, hrv: 55, rhr: 52, weight: 84.3, stepsPartial: 1200 });
assert.equal(p.workouts[0].category, "run"); assert.equal(p.workouts[0].distanceKm, 9.8); assert.equal(p.workouts[0].durationMin, 50); assert.equal(p.workouts[0].date, "2026-11-19");
// Format simple (raccourci iPhone), valeurs en texte avec virgule et unités
const s = parsePayload({ date: today, hrv: "62 ms", restingHr: "51", weight: "84,1 kg", sleepMinutes: 455.6 }, "Europe/Paris");
assert.deepEqual(s.days[today], { weight: 84.1, hrv: 62, rhr: 51, sleepMin: 456 });
// Valeurs absurdes ignorées
assert.deepEqual(parsePayload({ date: today, hrv: 9999, weight: 2 }, "Europe/Paris").days[today], {});
// Fusion + indicateurs
let ph = null;
for (let i = 10; i >= 1; i--) ph = mergePhone(ph, { days: { [addDays(today, -i)]: { hrv: 55 + (i % 3) * 3, rhr: 53, sleepMin: 450 } }, workouts: [] }, today);
ph = mergePhone(ph, p, today);
const h = phoneHealth(ph, today);
assert.equal(h.hrv.value, 55); assert.ok(h.hrv.low && h.hrv.high); assert.equal(h.sleep.duration, "7h 10min");
assert.equal(h.rhr.today, 52); assert.equal(Object.keys(ph.workouts).length, 1);
assert.equal(categoryFromExerciseType("EXERCISE_TYPE_BIKING"), "bike"); assert.equal(categoryFromExerciseType("STRENGTH_TRAINING"), "hybrid");
console.log("OK téléphone (Apple Santé / Health Connect)");
