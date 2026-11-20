import * as S from "./samples.mjs";
import { parseSportRecords, parseHrv, parseSleep, parseRecovery, parseRhr, parseLoad } from "../netlify/functions/_lib/coros.mjs";
import { dedupe, dailyPoint } from "../netlify/functions/_lib/engine.mjs";
import assert from "node:assert/strict";
const acts = parseSportRecords(S.records);
assert.equal(acts.length, 5);
assert.deepEqual(acts.map(a=>a.category), ["hybrid","bike","bike","run","hybrid"]);
assert.equal(acts[3].distanceKm, 13.51); assert.equal(acts[3].avgHr, 163); assert.equal(acts[3].durationMin, 82);
const d = dedupe(acts); assert.equal(d.length, 4, "Zwift doublon supprimé");
assert.ok(d.find(a=>a.category==="bike").avgHr === 134);
const h = parseHrv(S.hrv, "2026-11-19"); assert.equal(h.latest.value, 33); assert.equal(h.latest.low, 37); assert.equal(h.latest.evaluation, "sous ta normale");
assert.equal(parseSleep(S.sleep).length, 1); assert.equal(parseSleep(S.sleep)[0].score, 59);
assert.equal(parseRecovery(S.recovery).percent, 100);
assert.equal(parseRhr(S.rhr).length, 2);
assert.equal(parseLoad(S.load)[0].ratio, 0.78);
const p = dailyPoint({ profile:{ sports:["swim","bike","run","hybrid"], hrMax:185, hrRest:54, goal:{type:"ironman", date:"2027-06-20", targetWeight:85, weightDate:"2027-01-31"} },
  activities: acts, health:{ hrv:h.latest, sleep:parseSleep(S.sleep)[0], recovery:parseRecovery(S.recovery), rhr:{today:64, avg:59} },
  checkins:{ "2026-11-10":{weight:89.4}, "2026-11-19":{weight:88.6, fatigue:3} }, today:"2026-11-19" });
console.log(JSON.stringify({r:p.readiness, load:p.load, phase:p.phase, prop:p.proposals.map(x=>x.axis+" | "+x.title), alerts:p.alerts, w:p.weight.status, week:p.week}, null, 1));
console.log("OK parseurs + moteur");
