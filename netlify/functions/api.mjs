// API unique de l'application, servie sur /api/*.
import { users, db, sessionCookie, clearCookie, userIdFromRequest, newId, hash, newRecoveryCode, pkce, encrypt, decrypt } from "./_lib/store.mjs";
import * as strava from "./_lib/strava.mjs";
import { COROS_REGIONS, registerClient, authorizeUrl as corosAuthUrl, exchangeCode as corosExchange, refreshToken as corosRefresh, CorosMcp, fetchCorosData } from "./_lib/coros.mjs";
import { dailyPoint, normalizeStrava, GOALS, isoDay, addDays } from "./_lib/engine.mjs";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const redirect = (to, headers = {}) => new Response(null, { status: 302, headers: { Location: to, ...headers } });
const origin = (req) => process.env.URL || new URL(req.url).origin;

function todayIn(tz) {
  try {
    const p = new Intl.DateTimeFormat("fr-CA", { timeZone: tz || "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return p.slice(0, 10);
  } catch { return isoDay(new Date()); }
}

function publicUser(u) {
  return {
    id: u.id,
    profile: u.profile || null,
    onboarded: !!(u.profile && u.profile.name),
    strava: u.strava ? { connected: true, firstname: u.strava.firstname || "" } : { connected: false },
    coros: u.coros ? { connected: true, region: u.coros.region } : { connected: false },
    checkins: u.checkins || {},
    stravaAvailable: !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
    aiAvailable: !!process.env.ANTHROPIC_API_KEY,
    inviteRequired: !!process.env.INVITE_CODE,
  };
}

// ---------- Jetons ----------
async function stravaToken(u) {
  if (!u.strava) return null;
  let t = decrypt(u.strava.tokens);
  if (t.expiresAt - 120000 < Date.now()) {
    t = { ...t, ...(await strava.refresh({ clientId: process.env.STRAVA_CLIENT_ID, clientSecret: process.env.STRAVA_CLIENT_SECRET, refreshToken: t.refresh })) };
    u.strava.tokens = encrypt(t);
    u._dirty = true;
  }
  return t.access;
}
async function corosToken(u) {
  if (!u.coros) return null;
  const issuer = COROS_REGIONS[u.coros.region];
  let t = decrypt(u.coros.tokens);
  if (t.expiresAt - 120000 < Date.now()) {
    t = { ...t, ...(await corosRefresh(issuer, { clientId: u.coros.clientId, refresh: t.refresh })) };
    u.coros.tokens = encrypt(t);
    u._dirty = true;
  }
  return t.access;
}

// ---------- Collecte des données ----------
async function collect(u, today) {
  const errors = [];
  let stravaActs = [];
  let coros = { activities: [], health: {} };
  const jobs = [];
  if (u.strava) {
    jobs.push((async () => {
      try {
        const tok = await stravaToken(u);
        const after = Math.floor(new Date(addDays(today, -125) + "T00:00:00Z").getTime() / 1000);
        stravaActs = (await strava.listActivities(tok, after)).map(normalizeStrava);
      } catch (e) {
        errors.push({ source: "strava", message: e.message });
        if (e.code === 401) { delete u.strava; u._dirty = true; }
      }
    })());
  }
  if (u.coros) {
    jobs.push((async () => {
      try {
        const tok = await corosToken(u);
        coros = await fetchCorosData(new CorosMcp(COROS_REGIONS[u.coros.region], tok), today);
      } catch (e) {
        errors.push({ source: "coros", message: e.message });
        if (e.code === 401) { delete u.coros; u._dirty = true; }
      }
    })());
  }
  await Promise.all(jobs);
  return { activities: [...coros.activities, ...stravaActs], health: coros.health || {}, errors };
}

// ---------- Note du coach IA (données COROS et saisies manuelles uniquement) ----------
async function aiNote(u, point, health, today) {
  const corosActs = point.dashboards.recent.filter((a) => a.source === "coros")
    .map((a) => ({ date: a.date, sport: a.category, minutes: a.durationMin, km: a.distanceKm, fcMoy: a.avgHr }));
  const data = {
    date: today,
    objectif: { ...u.profile.goal, libelle: GOALS[u.profile.goal?.type]?.label },
    phase: point.phase,
    sports: u.profile.sports,
    disponibiliteHeuresSemaine: u.profile.hoursPerWeek,
    saisieDuJour: (u.checkins || {})[today] || {},
    poids: point.weight.status,
    corosSante: { vfc: health.hrv, sommeil: health.sleep, recuperation: health.recovery, fcRepos: health.rhr, chargeCoros: (health.corosLoad || []).slice(0, 3) },
    seancesCoros14j: corosActs,
    seancesProposees: point.proposals.map((p) => ({ axe: p.axis, titre: p.title, detail: p.detail })),
  };
  const prompt = `Tu es le coach d'un sportif amateur. Voici ses données du jour en JSON :
${JSON.stringify(data)}
Écris son point du matin en français, sur un ton naturel et direct, sans gras, sans titres, en 5 à 8 phrases :
comment il est ce matin (en citant 2 ou 3 chiffres), ce qu'il doit faire aujourd'hui parmi les séances proposées (tu peux l'ajuster), un conseil nutrition ou récupération concret lié à son objectif, et un point d'attention s'il y en a un.
N'invente aucune donnée absente. Si une donnée manque, n'en parle pas.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `IA indisponible (${r.status})`);
  return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}

// ---------- Routeur ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method;
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    // Création de compte (avec code d'invitation si défini).
    if (path === "/signup" && method === "POST") {
      if (process.env.INVITE_CODE && String(body.invite || "").trim() !== process.env.INVITE_CODE) return json({ error: "Code d'invitation incorrect" }, 403);
      const id = newId();
      const code = newRecoveryCode();
      await users.save({ id, createdAt: Date.now(), checkins: {}, recoveryHash: hash(code) });
      await db.set(`codes/${hash(code)}`, { userId: id });
      return json({ ok: true, recoveryCode: code }, 200, { "Set-Cookie": sessionCookie(id) });
    }
    if (path === "/login" && method === "POST") {
      const code = String(body.code || "").trim().toUpperCase();
      const link = code && (await db.get(`codes/${hash(code)}`));
      if (!link) return json({ error: "Code inconnu" }, 404);
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(link.userId) });
    }
    if (path === "/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearCookie });

    // Retour OAuth Strava (identifie aussi l'utilisateur sur un nouvel appareil).
    if (path === "/strava/callback") {
      const st = await db.get(`oauth/${url.searchParams.get("state")}`);
      if (!st || url.searchParams.get("error")) return redirect("/?erreur=strava");
      await db.del(`oauth/${url.searchParams.get("state")}`);
      const t = await strava.exchangeCode({ clientId: process.env.STRAVA_CLIENT_ID, clientSecret: process.env.STRAVA_CLIENT_SECRET, code: url.searchParams.get("code") });
      const scope = url.searchParams.get("scope") || "";
      if (!scope.includes("activity:read")) return redirect("/?erreur=strava-scope");
      const u = await users.get(st.userId);
      if (!u) return redirect("/?erreur=session");
      u.strava = { athleteId: t.athleteId, firstname: t.firstname, tokens: encrypt(t) };
      await users.save(u);
      await db.set(`strava/${t.athleteId}`, { userId: u.id });
      return redirect("/?connecte=strava", { "Set-Cookie": sessionCookie(u.id) });
    }
    if (path === "/coros/callback") {
      const st = await db.get(`oauth/${url.searchParams.get("state")}`);
      if (!st || url.searchParams.get("error")) return redirect("/?erreur=coros");
      await db.del(`oauth/${url.searchParams.get("state")}`);
      const issuer = COROS_REGIONS[st.region];
      const t = await corosExchange(issuer, { clientId: st.clientId, code: url.searchParams.get("code"), verifier: st.verifier, redirectUri: `${origin(req)}/api/coros/callback` });
      const u = await users.get(st.userId);
      if (!u) return redirect("/?erreur=session");
      u.coros = { region: st.region, clientId: st.clientId, tokens: encrypt(t) };
      await users.save(u);
      return redirect("/?connecte=coros", { "Set-Cookie": sessionCookie(u.id) });
    }

    // Tout le reste exige une session.
    const uid = userIdFromRequest(req);
    const u = uid && (await users.get(uid));
    if (!u) return json({ error: "non_connecte", inviteRequired: !!process.env.INVITE_CODE }, 401);

    if (path === "/me") return json(publicUser(u));

    if (path === "/profile" && method === "POST") {
      const p = body.profile || {};
      u.profile = {
        name: String(p.name || "").slice(0, 40),
        sex: p.sex === "f" ? "f" : "m",
        sports: (p.sports || []).filter((s) => ["run", "bike", "swim", "hybrid", "other"].includes(s)),
        hrMax: Number(p.hrMax) || null,
        hrRest: Number(p.hrRest) || null,
        hoursPerWeek: Number(p.hoursPerWeek) || null,
        tz: p.tz || "Europe/Paris",
        aiEnabled: !!p.aiEnabled,
        goal: {
          type: GOALS[p.goal?.type] ? p.goal.type : "fitness",
          name: String(p.goal?.name || "").slice(0, 60),
          date: /^\d{4}-\d{2}-\d{2}$/.test(p.goal?.date || "") ? p.goal.date : null,
          targetWeight: Number(p.goal?.targetWeight) || null,
          weightDate: /^\d{4}-\d{2}-\d{2}$/.test(p.goal?.weightDate || "") ? p.goal.weightDate : null,
        },
      };
      await users.save(u);
      return json(publicUser(u));
    }

    if (path === "/checkin" && method === "POST") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : todayIn(u.profile?.tz);
      const c = body.checkin || {};
      const clean = {};
      if (Number(c.weight) > 20 && Number(c.weight) < 300) clean.weight = Math.round(Number(c.weight) * 10) / 10;
      for (const k of ["sleep", "fatigue", "soreness", "mood"]) if (Number(c[k]) >= 1 && Number(c[k]) <= 5) clean[k] = Number(c[k]);
      if (c.note) clean.note = String(c.note).slice(0, 500);
      u.checkins = { ...(u.checkins || {}), [date]: { ...((u.checkins || {})[date] || {}), ...clean } };
      await users.save(u);
      return json({ ok: true, checkins: u.checkins });
    }

    if (path === "/point") {
      if (!u.profile) return json({ error: "profil_manquant" }, 400);
      const today = todayIn(u.profile.tz);
      const { activities, health, errors } = await collect(u, today);
      const point = dailyPoint({ profile: u.profile, activities, health, checkins: u.checkins || {}, today });
      if (u._dirty) { delete u._dirty; await users.save(u); }
      return json({
        point,
        health: { hrv: health.hrv, hrvHistory: health.hrvHistory || [], sleep: health.sleep, sleepHistory: health.sleepHistory || [], recovery: health.recovery, rhr: health.rhr, rhrHistory: health.rhrHistory || [], corosLoad: health.corosLoad || [] },
        errors,
        sources: { strava: !!u.strava, coros: !!u.coros },
      });
    }

    if (path === "/coach" && method === "POST") {
      if (!process.env.ANTHROPIC_API_KEY) return json({ error: "Coach IA non configuré" }, 400);
      if (!u.profile?.aiEnabled) return json({ error: "Coach IA désactivé dans tes réglages" }, 400);
      if (!u.coros && !Object.keys(u.checkins || {}).length) return json({ error: "Le coach IA a besoin de COROS ou de tes saisies du jour (les données Strava ne peuvent pas lui être transmises)." }, 400);
      const today = todayIn(u.profile.tz);
      const cacheKey = `coach/${u.id}/${today}`;
      const cached = !body.force && (await db.get(cacheKey));
      if (cached) return json(cached);
      let health = {}, activities = [];
      if (u.coros) {
        const tok = await corosToken(u);
        ({ health, activities } = await fetchCorosData(new CorosMcp(COROS_REGIONS[u.coros.region], tok), today));
      }
      const point = dailyPoint({ profile: u.profile, activities, health, checkins: u.checkins || {}, today });
      const text = await aiNote(u, point, health, today);
      const out = { text, at: Date.now() };
      await db.set(cacheKey, out);
      if (u._dirty) { delete u._dirty; await users.save(u); }
      return json(out);
    }

    if (path === "/strava/connect") {
      if (!process.env.STRAVA_CLIENT_ID) return redirect("/?erreur=strava-config");
      const state = newId();
      await db.set(`oauth/${state}`, { userId: u.id, at: Date.now() });
      return redirect(strava.authorizeUrl({ clientId: process.env.STRAVA_CLIENT_ID, redirectUri: `${origin(req)}/api/strava/callback`, state }));
    }
    if (path === "/coros/connect") {
      const region = COROS_REGIONS[url.searchParams.get("region")] ? url.searchParams.get("region") : "eu";
      const issuer = COROS_REGIONS[region];
      const redirectUri = `${origin(req)}/api/coros/callback`;
      const cfgKey = `config/coros-client-${region}`;
      let cfg = await db.get(cfgKey);
      if (!cfg || cfg.redirectUri !== redirectUri) {
        cfg = { clientId: await registerClient(issuer, redirectUri), redirectUri };
        await db.set(cfgKey, cfg);
      }
      const { verifier, challenge } = pkce();
      const state = newId();
      await db.set(`oauth/${state}`, { userId: u.id, region, clientId: cfg.clientId, verifier, at: Date.now() });
      return redirect(corosAuthUrl({ issuer, clientId: cfg.clientId, redirectUri, challenge, state }));
    }
    if (path === "/strava/disconnect" && method === "POST") {
      if (u.strava) {
        try { await strava.deauthorize(await stravaToken(u)); } catch { /* déjà révoqué */ }
        await db.del(`strava/${u.strava.athleteId}`);
        delete u.strava;
        await users.save(u);
      }
      return json(publicUser(u));
    }
    if (path === "/coros/disconnect" && method === "POST") {
      delete u.coros;
      await users.save(u);
      return json(publicUser(u));
    }
    if (path === "/recovery-code" && method === "POST") {
      if (u.recoveryHash) await db.del(`codes/${u.recoveryHash}`);
      const code = newRecoveryCode();
      u.recoveryHash = hash(code);
      await db.set(`codes/${u.recoveryHash}`, { userId: u.id });
      await users.save(u);
      return json({ recoveryCode: code });
    }
    if (path === "/export") {
      return new Response(JSON.stringify({ profile: u.profile, checkins: u.checkins }, null, 2), {
        headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="le-finisher-export.json"' },
      });
    }
    if (path === "/account" && method === "DELETE") {
      if (u.strava) { try { await strava.deauthorize(await stravaToken(u)); } catch { /* */ } await db.del(`strava/${u.strava.athleteId}`); }
      if (u.recoveryHash) await db.del(`codes/${u.recoveryHash}`);
      await users.remove(u.id);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie });
    }
    return json({ error: "introuvable" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Erreur serveur" }, 500);
  }
};

export const config = { path: "/api/*" };
