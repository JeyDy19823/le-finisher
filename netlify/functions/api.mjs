// API unique de l'application, servie sur /api/*.
import { ensureSecret, appConfig, saveAppConfig, users, db, sessionCookie, clearCookie, userIdFromRequest, newId, hash, newRecoveryCode, pkce, encrypt, decrypt } from "./_lib/store.mjs";
import * as strava from "./_lib/strava.mjs";
import { COROS_REGIONS, registerClient, authorizeUrl as corosAuthUrl, exchangeCode as corosExchange, refreshToken as corosRefresh, CorosMcp, fetchCorosData } from "./_lib/coros.mjs";
import { dailyPoint, normalizeStrava, GOALS, isoDay, addDays, dedupe } from "./_lib/engine.mjs";
import { updateGame, vestiairePoints } from "./_lib/game.mjs";
import { parsePayload, mergePhone, phoneHealth, phoneWeights } from "./_lib/phone.mjs";

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
    phone: u.phone?.lastSync ? { connected: true, lastSync: u.phone.lastSync, source: u.phone.source || "" } : { connected: false },
    checkins: u.checkins || {},
    stravaAvailable: !!(CFG.stravaId && CFG.stravaSecret),
    aiAvailable: !!process.env.ANTHROPIC_API_KEY,
    inviteRequired: !!CFG.invite,
    isAdmin: CFG.adminId === u.id,
    adminClaimable: !CFG.adminId,
  };
}

let CFG = {};

// ---------- Jetons ----------
async function stravaToken(u) {
  if (!u.strava) return null;
  let t = decrypt(u.strava.tokens);
  if (t.expiresAt - 120000 < Date.now()) {
    t = { ...t, ...(await strava.refresh({ clientId: CFG.stravaId, clientSecret: CFG.stravaSecret, refreshToken: t.refresh })) };
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
  // Le téléphone complète ce que COROS ne donne pas (ou remplace COROS si pas de montre COROS).
  const ph = phoneHealth(u.phone, today);
  const health = { ...(coros.health || {}) };
  for (const k of ["hrv", "sleep", "rhr"]) if (!health[k] && ph[k]) health[k] = ph[k];
  for (const k of ["hrvHistory", "sleepHistory", "rhrHistory"]) if (!(health[k] && health[k].length) && ph[k] && ph[k].length) health[k] = ph[k];
  health.sleepSource = coros.health?.lastNight ? "COROS" : ph.sleepHistory?.length ? "téléphone" : null;
  if (!health.lastNight && ph.sleepHistory?.length) {
    health.lastNight = ph.sleepHistory[ph.sleepHistory.length - 1];
    health.sleepPending = health.lastNight.date !== today;
  }
  const phoneActs = Object.values(u.phone?.workouts || {});
  return { activities: [...coros.activities, ...stravaActs, ...phoneActs], health, errors };
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

// ---------- Connexion par Strava / COROS ----------
async function findOrCreate(mapKey, invite) {
  const link = await db.get(mapKey);
  if (link) { const u = await users.get(link.userId); if (u) return u; }
  if (CFG.invite && String(invite || "").trim() !== CFG.invite) return null;
  const u = { id: newId(), createdAt: Date.now(), checkins: {} };
  await users.save(u);
  await db.set(mapKey, { userId: u.id });
  return u;
}

async function corosStart(req, region, extra) {
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
  await db.set(`oauth/${state}`, { ...extra, region, clientId: cfg.clientId, verifier, at: Date.now() });
  return redirect(corosAuthUrl({ issuer, clientId: cfg.clientId, redirectUri, challenge, state }));
}

// ---------- Routeur ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method;
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    await ensureSecret();
    CFG = await appConfig();
    // Création de compte (avec code d'invitation si défini).
    if (path === "/signup" && method === "POST") {
      if (CFG.invite && String(body.invite || "").trim() !== CFG.invite) return json({ error: "Code d'invitation incorrect" }, 403);
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

    // Réception des données du téléphone (Apple Santé via Raccourcis, Android via HC Webhook).
    if (path.startsWith("/ingest/") && method === "POST") {
      const token = path.slice("/ingest/".length);
      const link = token && (await db.get(`phone/${hash(token)}`));
      if (!link) return json({ error: "adresse inconnue" }, 404);
      const pu = await users.get(link.userId);
      if (!pu) return json({ error: "compte supprimé" }, 404);
      const tz = pu.profile?.tz || "Europe/Paris";
      const parsed = parsePayload(body, tz);
      pu.phone = mergePhone(pu.phone, parsed, todayIn(tz));
      pu.phone.source = body.app_version ? "android" : pu.phone.source || "iphone";
      await users.save(pu);
      return json({ ok: true, jours: Object.keys(parsed.days).length, seances: parsed.workouts.length });
    }

    // Connexion à son espace avec son compte Strava ou COROS (crée l'espace si besoin).
    if (path === "/strava/login") {
      if (!CFG.stravaId) return redirect("/?erreur=strava-config");
      const state = newId();
      await db.set(`oauth/${state}`, { mode: "login", invite: url.searchParams.get("invite") || "", at: Date.now() });
      return redirect(strava.authorizeUrl({ clientId: CFG.stravaId, redirectUri: `${origin(req)}/api/strava/callback`, state }));
    }
    if (path === "/coros/login") {
      const region = COROS_REGIONS[url.searchParams.get("region")] ? url.searchParams.get("region") : "eu";
      return corosStart(req, region, { mode: "login", invite: url.searchParams.get("invite") || "" });
    }

    // Retour OAuth Strava (identifie aussi l'utilisateur sur un nouvel appareil).
    if (path === "/strava/callback") {
      const st = await db.get(`oauth/${url.searchParams.get("state")}`);
      if (!st || url.searchParams.get("error")) return redirect("/?erreur=strava");
      await db.del(`oauth/${url.searchParams.get("state")}`);
      const t = await strava.exchangeCode({ clientId: CFG.stravaId, clientSecret: CFG.stravaSecret, code: url.searchParams.get("code") });
      const scope = url.searchParams.get("scope") || "";
      if (!scope.includes("activity:read")) return redirect("/?erreur=strava-scope");
      let u;
      if (st.mode === "login") {
        u = await findOrCreate(`strava/${t.athleteId}`, st.invite);
        if (!u) return redirect("/?erreur=invitation");
      } else u = await users.get(st.userId);
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
      let u;
      if (st.mode === "login") {
        if (!t.sub) return redirect("/?erreur=coros-login");
        u = await findOrCreate(`coros/${st.region}/${t.sub}`, st.invite);
        if (!u) return redirect("/?erreur=invitation");
      } else u = await users.get(st.userId);
      if (!u) return redirect("/?erreur=session");
      u.coros = { region: st.region, clientId: st.clientId, tokens: encrypt(t), sub: t.sub || null };
      await users.save(u);
      if (t.sub) await db.set(`coros/${st.region}/${t.sub}`, { userId: u.id });
      return redirect("/?connecte=coros", { "Set-Cookie": sessionCookie(u.id) });
    }

    // Tout le reste exige une session.
    const uid = userIdFromRequest(req);
    const u = uid && (await users.get(uid));
    if (!u) return json({ error: "non_connecte", inviteRequired: !!CFG.invite, stravaAvailable: !!CFG.stravaId }, 401);

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
        vestiaire: !!p.vestiaire,
        goal: {
          type: GOALS[p.goal?.type] ? p.goal.type : "fitness",
          name: String(p.goal?.name || "").slice(0, 60),
          date: /^\d{4}-\d{2}-\d{2}$/.test(p.goal?.date || "") ? p.goal.date : null,
          targetWeight: Number(p.goal?.targetWeight) || null,
          weightDate: /^\d{4}-\d{2}-\d{2}$/.test(p.goal?.weightDate || "") ? p.goal.weightDate : null,
        },
      };
      await users.save(u);
      const idx = (await db.get("vestiaire/index")) || { ids: [] };
      const has = idx.ids.includes(u.id);
      if (u.profile.vestiaire && !has) await db.set("vestiaire/index", { ids: [...idx.ids, u.id] });
      if (!u.profile.vestiaire && has) await db.set("vestiaire/index", { ids: idx.ids.filter((i) => i !== u.id) });
      return json(publicUser(u));
    }

    if (path === "/quest" && method === "POST") {
      const today = todayIn(u.profile?.tz);
      const game = u.game || { days: {}, badges: {}, weeks: {} };
      const day = { ...(game.days?.[today] || {}) };
      day.manual = { ...(day.manual || {}) };
      if (body.action === "session") { day.manual.session = true; day.manual.declared = true; }
      else if (body.action === "declare") day.manual.declared = true;
      else return json({ error: "action inconnue" }, 400);
      u.game = { ...game, days: { ...(game.days || {}), [today]: day } };
      await users.save(u);
      return json({ ok: true });
    }

    if (path === "/admin") {
      const host = new URL(origin(req)).host;
      if (method === "POST") {
        if (CFG.adminId !== u.id) return json({ error: "Réservé à l'administrateur" }, 403);
        await saveAppConfig({ stravaId: body.stravaId, stravaSecret: body.stravaSecret, invite: body.invite });
        CFG = await appConfig();
      }
      return json({
        isAdmin: CFG.adminId === u.id, claimable: !CFG.adminId,
        stravaId: CFG.adminId === u.id ? CFG.stravaId : null, hasStravaSecret: !!CFG.stravaSecret,
        invite: CFG.adminId === u.id ? CFG.invite : null, fromEnv: CFG.fromEnv, callbackDomain: host,
        users: CFG.adminId === u.id ? ((await db.get("vestiaire/index")) || { ids: [] }).ids.length : null,
      });
    }
    if (path === "/admin/claim" && method === "POST") {
      if (CFG.adminId) return json({ error: "Il y a déjà un administrateur" }, 409);
      await saveAppConfig({ adminId: u.id });
      CFG = await appConfig();
      return json({ ok: true });
    }

    if (path === "/vestiaire") {
      if (!u.profile?.vestiaire) return json({ enabled: false, members: [] });
      const today = todayIn(u.profile.tz);
      const idx = (await db.get("vestiaire/index")) || { ids: [] };
      const members = [];
      for (const id of idx.ids.slice(0, 50)) {
        const m = id === u.id ? u : await users.get(id);
        if (!m || !m.profile?.vestiaire) continue;
        members.push({ name: m.profile.name, me: m.id === u.id, ...vestiairePoints(m, today) });
      }
      members.sort((a, b) => b.points - a.points || b.streak - a.streak);
      return json({ enabled: true, members });
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
      // Les pesées du téléphone alimentent la courbe de poids sans valider la quête « ressenti ».
      const withWeights = { ...(u.checkins || {}) };
      for (const [d, w] of Object.entries(phoneWeights(u.phone))) withWeights[d] = { weight: w, ...(withWeights[d] || {}) };
      const point = dailyPoint({ profile: u.profile, activities, health, checkins: withWeights, today });
      const g = updateGame({ game: u.game, point, acts: dedupe(activities), checkins: u.checkins || {}, health, profile: u.profile, today });
      const changed = JSON.stringify(g.state) !== JSON.stringify(u.game || null);
      u.game = g.state;
      if (u._dirty || changed) { delete u._dirty; await users.save(u); }
      return json({
        point,
        game: g.view,
        health: { lastNight: health.lastNight || null, sleepPending: !!health.sleepPending, sleepSource: health.sleepSource || null, hrv: health.hrv, hrvHistory: health.hrvHistory || [], sleep: health.sleep, sleepHistory: health.sleepHistory || [], recovery: health.recovery, rhr: health.rhr, rhrHistory: health.rhrHistory || [], corosLoad: health.corosLoad || [] },
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
      if (!CFG.stravaId) return redirect("/?erreur=strava-config");
      const state = newId();
      await db.set(`oauth/${state}`, { userId: u.id, at: Date.now() });
      return redirect(strava.authorizeUrl({ clientId: CFG.stravaId, redirectUri: `${origin(req)}/api/strava/callback`, state }));
    }
    if (path === "/coros/connect") {
      const region = COROS_REGIONS[url.searchParams.get("region")] ? url.searchParams.get("region") : "eu";
      return corosStart(req, region, { userId: u.id });
    }
    if (path === "/phone") {
      let token = u.phoneToken ? decrypt(u.phoneToken).t : null;
      if (!token || url.searchParams.get("reset") === "1") {
        if (u.phoneTokenHash) await db.del(`phone/${u.phoneTokenHash}`);
        token = newId() + newId();
        u.phoneToken = encrypt({ t: token });
        u.phoneTokenHash = hash(token);
        await db.set(`phone/${u.phoneTokenHash}`, { userId: u.id });
        await users.save(u);
      }
      return json({ url: `${origin(req)}/api/ingest/${token}`, lastSync: u.phone?.lastSync || null, days: Object.keys(u.phone?.days || {}).length, workouts: Object.keys(u.phone?.workouts || {}).length });
    }
    if (path === "/phone/disconnect" && method === "POST") {
      if (u.phoneTokenHash) await db.del(`phone/${u.phoneTokenHash}`);
      delete u.phone; delete u.phoneToken; delete u.phoneTokenHash;
      await users.save(u);
      return json(publicUser(u));
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
      if (u.coros?.sub) await db.del(`coros/${u.coros.region}/${u.coros.sub}`);
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
      if (u.phoneTokenHash) await db.del(`phone/${u.phoneTokenHash}`);
      if (u.coros?.sub) await db.del(`coros/${u.coros.region}/${u.coros.sub}`);
      const idx = (await db.get("vestiaire/index")) || { ids: [] };
      if (idx.ids.includes(u.id)) await db.set("vestiaire/index", { ids: idx.ids.filter((i) => i !== u.id) });
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
