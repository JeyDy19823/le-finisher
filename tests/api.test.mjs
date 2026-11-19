// Test de bout en bout du routeur avec Strava, COROS, Anthropic et Netlify Blobs simulés.
import assert from "node:assert/strict";
import * as S from "./samples.mjs";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.STRAVA_CLIENT_ID = "123"; process.env.STRAVA_CLIENT_SECRET = "sec";
process.env.ANTHROPIC_API_KEY = "k"; process.env.INVITE_CODE = "TRI2027"; process.env.URL = "https://forme.example";
const mem = new Map();
globalThis.__FDJ_STORE = { get: async (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : null), setJSON: async (k, v) => mem.set(k, JSON.stringify(v)), delete: async (k) => mem.delete(k) };
const calls = [];
let aiPrompt = "";
const today = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date()).slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push(url);
  const ok = (j, h = {}) => new Response(typeof j === "string" ? j : JSON.stringify(j), { status: 200, headers: { "content-type": "application/json", ...h } });
  if (url.startsWith("https://www.strava.com/oauth/token")) return ok({ access_token: "sa", refresh_token: "sr", expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: 42, firstname: "Jeremy" } });
  if (url.startsWith("https://www.strava.com/api/v3/athlete/activities")) {
    const acts = [];
    for (let i = 60; i >= 1; i -= 2) acts.push({ id: 1000 + i, name: "Footing", sport_type: "Run", start_date: daysAgo(i).toISOString(), start_date_local: daysAgo(i).toISOString(), moving_time: 3600, distance: 10000, has_heartrate: true, average_heartrate: 145 });
    // Doublon de la course COROS du 15/11 n'a pas lieu ici (dates récentes) : on ajoute un doublon d'une activité COROS simulée plus bas.
    acts.push({ id: 9, name: "Run doublon", sport_type: "Run", start_date: new Date(1794732870000 + 60000).toISOString(), start_date_local: "2026-11-15T09:15:00Z", moving_time: 4900, distance: 13510 });
    return ok(acts);
  }
  if (url.endsWith("/connect/register")) return ok({ client_id: "cc1" });
  if (url.endsWith("/oauth2/token")) return ok({ access_token: "ca", refresh_token: "cr", expires_in: 3600, id_token: "e30." + Buffer.from(JSON.stringify({ sub: "coros-user-7" })).toString("base64url") + ".x" });
  if (url.endsWith("/mcp")) {
    const b = JSON.parse(opts.body);
    if (b.method === "initialize") return ok({ jsonrpc: "2.0", id: b.id, result: { protocolVersion: "2025-06-18" } }, { "mcp-session-id": "s1" });
    assert.equal(opts.headers.Authorization, "Bearer ca");
    const map = { querySportRecords: S.records, querySleepHrv: S.hrv, querySleepOverview: S.sleep, queryRecoveryStatus: S.recovery, queryRestingHeartRate: S.rhr, queryTrainingLoadAssessment: S.load };
    const text = JSON.stringify(map[b.params.name] || "");
    // Réponse en flux SSE, comme le serveur COROS peut le faire.
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text }] } })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (url.startsWith("https://api.anthropic.com")) { aiPrompt = JSON.parse(opts.body).messages[0].content; return ok({ content: [{ type: "text", text: "Point du coach." }] }); }
  throw new Error("URL inattendue " + url);
};
const { default: handler } = await import("../netlify/functions/api.mjs");
let cookie = "";
const call = async (path, { method = "GET", body } = {}) => {
  const r = await handler(new Request("https://forme.example/api" + path, { method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j, loc: r.headers.get("location") };
};
assert.equal((await call("/me")).status, 401);
assert.equal((await call("/signup", { method: "POST", body: { invite: "faux" } })).status, 403);
const s = await call("/signup", { method: "POST", body: { invite: "TRI2027" } });
assert.equal(s.status, 200); assert.match(s.j.recoveryCode, /^\w{4}-\w{4}-\w{4}$/);
const prof = await call("/profile", { method: "POST", body: { profile: { name: "Jeremy", sports: ["swim", "bike", "run", "hybrid"], hrMax: 185, hrRest: 54, tz: "Europe/Paris", aiEnabled: true, goal: { type: "ironman", name: "Ironman", date: "2027-06-20", targetWeight: 85, weightDate: "2027-01-31" } } } });
assert.equal(prof.j.onboarded, true);
// Strava OAuth
const c1 = await call("/strava/connect"); assert.equal(c1.status, 302);
const state = new URL(c1.loc).searchParams.get("state"); assert.ok(c1.loc.includes("activity%3Aread_all"));
const cb = await call(`/strava/callback?state=${state}&code=abc&scope=read,activity:read_all`); assert.equal(cb.loc, "/?connecte=strava");
// COROS OAuth
const c2 = await call("/coros/connect?region=eu"); assert.equal(c2.status, 302);
const u2 = new URL(c2.loc); assert.equal(u2.origin, "https://mcpeu.coros.com"); assert.equal(u2.searchParams.get("code_challenge_method"), "S256"); assert.equal(u2.searchParams.get("resource"), "https://mcpeu.coros.com/mcp");
const cb2 = await call(`/coros/callback?state=${u2.searchParams.get("state")}&code=xyz`); assert.equal(cb2.loc, "/?connecte=coros");
// Jetons chiffrés au repos
const raw = [...mem.entries()].find(([k]) => k.startsWith("users/"))[1];
assert.ok(!raw.includes('"sa"') && !raw.includes('"ca"'), "jetons non chiffrés !");
// Saisie + point
await call("/checkin", { method: "POST", body: { checkin: { weight: 88.4, fatigue: 2, sleep: 4 } } });
const pt = await call("/point"); assert.equal(pt.status, 200, JSON.stringify(pt.j));
const P = pt.j.point;
assert.equal(pt.j.errors.length, 0);
assert.ok(P.readiness.score > 0); assert.equal(P.proposals.length, 2);
assert.ok(!P.dashboards.recent.some((a) => a.name === "Run doublon"), "doublon Strava/COROS non fusionné");
assert.ok(P.load.ctl > 10, "historique Strava pris en compte");
console.log("Point :", P.readiness.score, P.readiness.label, "| CTL", P.load.ctl, "TSB", P.load.tsb, "|", P.proposals.map((p) => p.title).join(" / "));
// Coach IA : aucune donnée Strava dans le prompt
const co = await call("/coach", { method: "POST", body: {} }); assert.equal(co.j.text, "Point du coach.");
assert.ok(!/strava|Footing/i.test(aiPrompt), "des données Strava ont fuité vers l'IA");
assert.ok(aiPrompt.includes("Below normal"));
// Gamification
assert.ok(pt.j.game && pt.j.game.quests.length === 3, "quêtes absentes");
assert.ok(pt.j.game.level.xp > 0);
const pt2 = await call("/point"); assert.equal(pt2.j.game.xpGained, 0, "XP comptée deux fois");
await call("/quest", { method: "POST", body: { action: "declare" } });
await call("/profile", { method: "POST", body: { profile: { ...prof.j.profile, vestiaire: true } } });
const v1 = await call("/vestiaire"); assert.equal(v1.j.enabled, true); assert.equal(v1.j.members.length, 1); assert.equal(v1.j.members[0].points, 30);
assert.ok(!JSON.stringify(v1.j).match(/km|bpm|Footing|load|ctl/i), "données d'activité exposées au vestiaire");
// Téléphone : adresse personnelle + réception
const ph = await call("/phone"); assert.match(ph.j.url, /\/api\/ingest\/[\w-]{20,}$/);
const ing = await handler(new Request(ph.j.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: today, hrv: "61 ms", restingHr: 50, weight: 87.9, sleepMinutes: 470 }) }));
assert.equal(ing.status, 200);
assert.equal((await handler(new Request("https://forme.example/api/ingest/fauxjeton", { method: "POST", body: "{}" }))).status, 404);
const me2 = await call("/me"); assert.equal(me2.j.phone.connected, true);
// Connexion avec COROS depuis un autre appareil : on retrouve le même espace
const savedCk = cookie; cookie = "";
const lc = await call("/coros/login?region=eu&invite=");
const lcs = new URL(lc.loc).searchParams.get("state");
const lcb = await call(`/coros/callback?state=${lcs}&code=zz`); assert.equal(lcb.loc, "/?connecte=coros");
assert.equal(cookie, savedCk, "la connexion COROS n'a pas retrouvé l'espace");
// Connexion Strava d'un inconnu sans code d'invitation : refusée
cookie = "";
const ls = await call("/strava/login?invite=");
mem.delete("strava/42");
const lsb = await call(`/strava/callback?state=${new URL(ls.loc).searchParams.get("state")}&code=a&scope=read,activity:read_all`);
assert.equal(lsb.loc, "/?erreur=invitation");
cookie = savedCk;
// Reconnexion par code
const saved = cookie; cookie = "";
assert.equal((await call("/login", { method: "POST", body: { code: s.j.recoveryCode.toLowerCase() } })).status, 200);
assert.equal(cookie, saved);
// Cookie falsifié refusé
cookie = cookie.replace(/.$/, "A"); assert.equal((await call("/me")).status, 401); cookie = saved;
// Suppression
assert.equal((await call("/account", { method: "DELETE" })).status, 200);
assert.equal([...mem.keys()].filter((k) => k.startsWith("users/")).length, 0);
console.log("OK API de bout en bout");
