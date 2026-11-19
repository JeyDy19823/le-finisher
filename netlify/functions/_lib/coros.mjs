// Connexion COROS via le serveur MCP officiel (https://github.com/coroslab/coros-mcp).
// Accès en libre-service, sans candidature : OAuth 2.0 + PKCE, enregistrement
// dynamique du client, une connexion par utilisateur et uniquement ses données.
// Recette OAuth reprise du script officiel coros_mcp_login.py.

import { categoryFromCoros } from "./engine.mjs";

export const COROS_REGIONS = {
  eu: "https://mcpeu.coros.com",
  us: "https://mcpus.coros.com",
  cn: "https://mcpcn.coros.com",
};
const SCOPES = "openid offline_access mcp.tools";
const PROTOCOL = "2025-06-18";

export async function registerClient(issuer, redirectUri) {
  const r = await fetch(`${issuer}/connect/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Forme du jour",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPES,
      token_endpoint_auth_method: "none",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.client_id) throw new Error(`Enregistrement COROS refusé (${r.status})`);
  return j.client_id;
}

export function authorizeUrl({ issuer, clientId, redirectUri, challenge, state }) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${issuer}/mcp`,
    state,
  });
  return `${issuer}/oauth2/authorize?${q}`;
}

async function tokenRequest(issuer, form) {
  const r = await fetch(`${issuer}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Jeton COROS refusé (${r.status})`);
  return {
    access: j.access_token,
    refresh: j.refresh_token,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
}

export const exchangeCode = (issuer, { clientId, code, verifier, redirectUri }) =>
  tokenRequest(issuer, { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier });

export const refreshToken = (issuer, { clientId, refresh }) =>
  tokenRequest(issuer, { grant_type: "refresh_token", client_id: clientId, refresh_token: refresh });

function parseRpc(text, contentType) {
  if (!text) return {};
  if ((contentType || "").includes("text/event-stream")) {
    const events = text.split(/\n\n/).map((b) => b.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n")).filter(Boolean);
    return events.length ? JSON.parse(events[events.length - 1]) : {};
  }
  return JSON.parse(text);
}

// Client MCP minimal (HTTP streamable, sans état) : initialize puis tools/call.
export class CorosMcp {
  constructor(issuer, accessToken) {
    this.url = `${issuer}/mcp`;
    this.token = accessToken;
    this.ready = null;
    this.id = 1;
    this.session = null;
  }
  async rpc(method, params) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": PROTOCOL,
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const r = await fetch(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: this.id++, method, params: params || {} }) });
    if (r.status === 401) { const e = new Error("COROS : connexion expirée"); e.code = 401; throw e; }
    const sid = r.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    const payload = parseRpc(await r.text(), r.headers.get("content-type"));
    if (!r.ok || payload.error) throw new Error(`COROS ${method} : ${payload.error?.message || r.status}`);
    return payload.result;
  }
  async init() {
    if (!this.ready) this.ready = this.rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Forme du jour", version: "1.0.0" } });
    return this.ready;
  }
  async call(name, args = {}) {
    await this.init();
    const res = await this.rpc("tools/call", { name, arguments: args });
    const text = (res?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    // Certains serveurs renvoient le texte encodé en JSON (chaîne entre guillemets).
    try { const j = JSON.parse(text); if (typeof j === "string") return j; } catch { /* texte brut */ }
    return text;
  }
}

// ---------- Lecture des réponses texte de COROS ----------
const ymd = (d) => d.replace(/-/g, "");

function durationToMin(s) {
  const p = String(s).trim().split(":").map(Number);
  if (p.some(Number.isNaN)) return 0;
  if (p.length === 3) return Math.round(p[0] * 60 + p[1] + p[2] / 60);
  if (p.length === 2) return Math.round(p[0] + p[1] / 60);
  return 0;
}

export function parseSportRecords(text) {
  const out = [];
  const blocks = String(text).split(/\n(?=\d+\.\s)/);
  for (const b of blocks) {
    const head = b.match(/^\d+\.\s+(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})/);
    if (!head) continue;
    const g = (re) => (b.match(re) || [])[1];
    const type = g(/SportType:\s*(\d+)/);
    const start = g(/startTimestamp=(\d+)/);
    const dist = g(/Distance:\s*([\d.]+)\s*km/);
    const dur = g(/Duration:\s*([\d:]+)/);
    const hr = g(/Avg HR:\s*(\d+)/);
    const label = g(/LabelId:\s*(\d+)/);
    out.push({
      id: `coros-${label || start || out.length}`,
      source: "coros",
      url: null,
      name: `${head[1]}${g(/Location:\s*(.+)/) ? " · " + g(/Location:\s*(.+)/).trim() : ""}`,
      date: head[2],
      start: start ? Number(start) * 1000 : null,
      category: categoryFromCoros(type),
      durationMin: dur ? durationToMin(dur) : 0,
      distanceKm: dist ? Number(dist) : 0,
      avgHr: hr ? Number(hr) : null,
      elevation: 0,
    });
  }
  return out;
}

export function parseHrv(text, today) {
  const re = /(\d{4}-\d{2}-\d{2}):\s*\n\s*HRV Avg:\s*(\d+)\s*ms(?:\s*—\s*([^\n]+))?\s*\n\s*Normal Range:\s*(\d+)\s*-\s*(\d+)\s*ms(?:\s*\n\s*Baseline:\s*(\d+))?/g;
  const days = [];
  let m;
  while ((m = re.exec(String(text)))) days.push({ date: m[1], value: +m[2], evaluation: (m[3] || "").trim(), low: +m[4], high: +m[5], baseline: m[6] ? +m[6] : null });
  const latest = days.filter((d) => d.date <= today).pop() || null;
  return { latest, days };
}

export function parseSleep(text) {
  const out = [];
  for (const b of String(text).split(/\n(?=\d{4}-\d{2}-\d{2}\n)/)) {
    const date = (b.match(/^(\d{4}-\d{2}-\d{2})\n/) || [])[1];
    const score = Number((b.match(/Sleep Score:\s*(\d+)/) || [])[1]);
    if (!date || !score) continue;
    out.push({
      date,
      score,
      duration: (b.match(/Main Sleep \(asleep\):\s*([^\n]+)/) || [])[1] || "",
      deep: Number((b.match(/Deep Sleep Ratio:\s*(\d+)/) || [])[1]) || null,
    });
  }
  return out;
}

export function parseRecovery(text) {
  const p = (String(text).match(/Recovery:\s*(\d+)\s*%/) || [])[1];
  return p == null ? null : { percent: Number(p), level: (String(text).match(/Level:\s*([^\n]+)/) || [])[1] || "" };
}

export function parseRhr(text) {
  const vals = [...String(text).matchAll(/(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*bpm/g)].map((m) => ({ date: m[1], bpm: +m[2] }));
  return vals;
}

export function parseLoad(text) {
  const out = [];
  for (const b of String(text).split(/\n(?=\d{4}-\d{2}-\d{2}\n)/)) {
    const date = (b.match(/^(\d{4}-\d{2}-\d{2})\n/) || [])[1];
    if (!date) continue;
    out.push({
      date,
      comment: ((b.match(/Comment:\s*([^\n]+)/) || [])[1] || "").trim(),
      shortTerm: Number((b.match(/Short-Term Load:\s*([\d.]+)/) || [])[1]) || null,
      longTerm: Number((b.match(/Long-Term Load:\s*([\d.]+)/) || [])[1]) || null,
      ratio: Number((b.match(/Load Ratio:\s*([\d.]+)/) || [])[1]) || null,
    });
  }
  return out;
}

// Récupère tout ce dont le point du jour a besoin. Les appels tolèrent les erreurs
// une par une : une donnée manquante ne bloque pas le reste.
export async function fetchCorosData(mcp, today, historyDays = 120) {
  const safe = (p) => p.catch((e) => { if (e.code === 401) throw e; return ""; });
  const chunks = [];
  for (let i = historyDays; i > 0; i -= 30) {
    const s = new Date(today + "T12:00:00"); s.setDate(s.getDate() - i);
    const e = new Date(today + "T12:00:00"); e.setDate(e.getDate() - Math.max(i - 30, 0));
    const f = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    chunks.push(safe(mcp.call("querySportRecords", { startDate: f(s), endDate: i - 30 <= 0 ? ymd(today) : f(e), limit: 150 })));
  }
  const [records, hrv, sleep, recovery, rhr, load] = await Promise.all([
    Promise.all(chunks),
    safe(mcp.call("querySleepHrv", { days: 7 })),
    safe(mcp.call("querySleepOverview", { days: 14 })),
    safe(mcp.call("queryRecoveryStatus", {})),
    safe(mcp.call("queryRestingHeartRate", { days: 14 })),
    safe(mcp.call("queryTrainingLoadAssessment", { days: 7 })),
  ]);
  const seen = new Set();
  const activities = records.flatMap(parseSportRecords).filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
  const hrvP = parseHrv(hrv, today);
  const sleepP = parseSleep(sleep);
  const rhrP = parseRhr(rhr);
  const rhrToday = rhrP.find((r) => r.date === today) || rhrP[0] || null;
  const rhrAvg = rhrP.length ? rhrP.reduce((s, r) => s + r.bpm, 0) / rhrP.length : null;
  const lastSleep = sleepP.filter((s) => s.date <= today).pop() || null;
  return {
    activities,
    health: {
      hrv: hrvP.latest,
      hrvHistory: hrvP.days,
      sleep: lastSleep && lastSleep.date >= addIso(today, -1) ? lastSleep : null,
      sleepHistory: sleepP,
      recovery: parseRecovery(recovery),
      rhr: rhrToday ? { today: rhrToday.bpm, date: rhrToday.date, avg: rhrAvg } : null,
      rhrHistory: rhrP,
      corosLoad: parseLoad(load),
    },
  };
}

function addIso(iso, n) {
  const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
