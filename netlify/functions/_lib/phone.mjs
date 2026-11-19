// Données de santé du téléphone : Apple Santé (iPhone) et Health Connect (Android).
// Aucune API web n'existe pour ces deux sources : c'est le téléphone qui envoie ses données
// vers une adresse personnelle et secrète propre à chaque utilisateur.
//
// Formats acceptés :
// 1. HC Webhook (Android, https://github.com/mcnaveen/health-connect-webhook) : clés snake_case
//    (sleep, heart_rate_variability, resting_heart_rate, weight, steps, exercise).
// 2. Format simple, pensé pour un raccourci iPhone gratuit (app Raccourcis) :
//    { "date": "2026-11-20", "weight": 84.2, "hrv": 58, "restingHr": 52, "sleepMinutes": 455, "steps": 9000 }
//    Les nombres peuvent arriver en texte (« 58 ms », « 84,2 kg »), ils sont nettoyés.

import { addDays, daysBetween } from "./engine.mjs";

const num = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function localDay(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  try { return new Intl.DateTimeFormat("fr-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).slice(0, 10); }
  catch { return String(iso).slice(0, 10); }
}
function localHour(iso, tz) {
  try { const h = parseInt(new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)), 10); return Number.isNaN(h) ? null : h; } catch { return null; }
}

export function categoryFromExerciseType(t) {
  const s = String(t || "").toUpperCase();
  if (/RUN|TREADMILL/.test(s)) return "run";
  if (/BIK|CYCL|RIDE/.test(s)) return "bike";
  if (/SWIM/.test(s)) return "swim";
  if (/STRENGTH|WEIGHT|CROSSFIT|HIIT|HIGH_INTENSITY|BOOT_CAMP|CALISTHENICS|ROWING|ELLIPTICAL|STAIR|BOXING|FUNCTIONAL|CROSS_TRAINING|CORE/.test(s)) return "hybrid";
  return "other";
}

// Transforme un envoi du téléphone en mises à jour par jour et en séances.
export function parsePayload(body, tz = "Europe/Paris") {
  const days = {};
  const workouts = [];
  const day = (d) => (days[d] = days[d] || {});
  if (!body || typeof body !== "object") return { days, workouts };

  // Format simple (raccourci iPhone).
  if (body.date || body.weight != null || body.hrv != null || body.sleepMinutes != null || body.restingHr != null) {
    const d = /^\d{4}-\d{2}-\d{2}/.test(String(body.date || "")) ? String(body.date).slice(0, 10) : localDay(new Date().toISOString(), tz);
    const t = day(d);
    const w = num(body.weight); if (w > 20 && w < 300) t.weight = Math.round(w * 10) / 10;
    const h = num(body.hrv); if (h > 5 && h < 300) t.hrv = Math.round(h);
    const r = num(body.restingHr); if (r > 25 && r < 130) t.rhr = Math.round(r);
    let sl = num(body.sleepMinutes); if (sl == null && num(body.sleepHours) != null) sl = num(body.sleepHours) * 60;
    if (sl > 30 && sl < 1000) t.sleepMin = Math.round(sl);
    const st = num(body.steps); if (st != null && st >= 0 && st < 200000) t.steps = Math.round(st);
  }

  // Format HC Webhook (Android).
  for (const w of body.weight && Array.isArray(body.weight) ? body.weight : []) {
    const kg = num(w.kilograms); if (kg > 20 && kg < 300) day(localDay(w.time, tz)).weight = Math.round(kg * 10) / 10;
  }
  const hrvBy = {};
  for (const h of Array.isArray(body.heart_rate_variability) ? body.heart_rate_variability : []) {
    const v = num(h.avg ?? h.rmssd_millis); if (!(v > 5 && v < 300)) continue;
    const hr = localHour(h.time, tz);
    if (hr != null && hr > 10 && hr < 21) continue; // on garde la nuit et le réveil
    (hrvBy[localDay(h.time, tz)] = hrvBy[localDay(h.time, tz)] || []).push(v);
  }
  for (const [d, vals] of Object.entries(hrvBy)) day(d).hrv = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  for (const r of Array.isArray(body.resting_heart_rate) ? body.resting_heart_rate : []) {
    const v = num(r.bpm); if (v > 25 && v < 130) day(localDay(r.time, tz)).rhr = Math.round(v);
  }
  for (const s of Array.isArray(body.sleep) ? body.sleep : []) {
    const awake = (s.stages || []).filter((x) => /AWAKE|OUT_OF_BED/i.test(String(x.stage))).reduce((t, x) => t + (num(x.duration_seconds) || 0), 0);
    const min = Math.round(((num(s.duration_seconds) || 0) - awake) / 60);
    if (min > 30 && s.session_end_time) { const t = day(localDay(s.session_end_time, tz)); t.sleepMin = Math.max(t.sleepMin || 0, min); }
  }
  const stepsBy = {};
  for (const s of Array.isArray(body.steps) ? body.steps : []) { const d = localDay(s.start_time, tz); stepsBy[d] = (stepsBy[d] || 0) + (num(s.count) || 0); }
  for (const [d, n] of Object.entries(stepsBy)) day(d).stepsPartial = n;
  for (const e of Array.isArray(body.exercise) ? body.exercise : []) {
    if (!e.start_time) continue;
    const start = Date.parse(e.start_time);
    workouts.push({
      id: `phone-${e.metadata?.id || start}`,
      source: "phone", url: null,
      name: String(e.type || "Séance").replace(/^EXERCISE_TYPE_/, "").replace(/_/g, " ").toLowerCase(),
      date: localDay(e.start_time, tz), start, hour: localHour(e.start_time, tz),
      category: categoryFromExerciseType(e.type),
      durationMin: Math.round((num(e.duration_seconds) || 0) / 60),
      distanceKm: e.distance_meters ? Math.round(num(e.distance_meters) / 10) / 100 : 0,
      avgHr: null, elevation: 0,
    });
  }
  return { days, workouts };
}

// Fusionne dans le stockage de l'utilisateur, en gardant 150 jours.
export function mergePhone(prev, parsed, today) {
  const phone = { days: { ...(prev?.days || {}) }, workouts: { ...(prev?.workouts || {}) }, lastSync: Date.now(), source: prev?.source };
  for (const [d, v] of Object.entries(parsed.days)) {
    const cur = { ...(phone.days[d] || {}) };
    for (const [k, val] of Object.entries(v)) {
      if (k === "stepsPartial") cur.steps = Math.max(cur.steps || 0, val);
      else cur[k] = val;
    }
    phone.days[d] = cur;
  }
  for (const w of parsed.workouts) if (w.durationMin >= 5) phone.workouts[w.id] = w;
  const limit = addDays(today, -150);
  for (const d of Object.keys(phone.days)) if (d < limit) delete phone.days[d];
  for (const [id, w] of Object.entries(phone.workouts)) if (w.date < limit) delete phone.workouts[id];
  return phone;
}

const fmtSleep = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min`;

// Construit les indicateurs santé à partir du téléphone, dans le même format que COROS.
export function phoneHealth(phone, today) {
  if (!phone || !phone.days) return {};
  const days = Object.entries(phone.days).sort(([a], [b]) => (a < b ? -1 : 1));
  const recent = (n) => days.filter(([d]) => daysBetween(d, today) >= 0 && daysBetween(d, today) < n);
  const out = {};
  const hrvs = recent(30).filter(([, v]) => v.hrv);
  const latestHrv = hrvs.filter(([d]) => daysBetween(d, today) <= 1).pop();
  if (latestHrv) {
    const vals = hrvs.map(([, v]) => v.hrv);
    let low = null, high = null;
    if (vals.length >= 7) {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
      low = Math.round(mean - sd); high = Math.round(mean + sd);
    }
    const v = latestHrv[1].hrv;
    out.hrv = { date: latestHrv[0], value: v, low, high, evaluation: low == null ? "" : v < low ? "sous ta normale" : v > high ? "au-dessus de ta normale" : "dans ta normale" };
    out.hrvHistory = recent(7).filter(([, x]) => x.hrv).map(([d, x]) => ({ date: d, value: x.hrv, low, high }));
  }
  const sl = recent(2).filter(([, v]) => v.sleepMin).pop();
  if (sl) out.sleep = { date: sl[0], score: Math.max(0, Math.min(100, Math.round((sl[1].sleepMin / 480) * 85))), duration: fmtSleep(sl[1].sleepMin), estimated: true };
  out.sleepHistory = recent(14).filter(([, v]) => v.sleepMin).map(([d, v]) => ({ date: d, score: Math.min(100, Math.round((v.sleepMin / 480) * 85)), duration: fmtSleep(v.sleepMin) }));
  const rh = recent(14).filter(([, v]) => v.rhr);
  const rhToday = rh.filter(([d]) => daysBetween(d, today) <= 1).pop();
  if (rhToday) out.rhr = { today: rhToday[1].rhr, date: rhToday[0], avg: rh.reduce((s, [, v]) => s + v.rhr, 0) / rh.length };
  out.rhrHistory = rh.map(([d, v]) => ({ date: d, bpm: v.rhr })).reverse();
  return out;
}

// Poids du téléphone, pour la courbe (sans compter comme ressenti du jour).
export function phoneWeights(phone) {
  const out = {};
  for (const [d, v] of Object.entries(phone?.days || {})) if (v.weight) out[d] = v.weight;
  return out;
}
