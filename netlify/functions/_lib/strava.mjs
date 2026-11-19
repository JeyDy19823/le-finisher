// Connexion Strava (API v3, OAuth 2.0).
// Règles Strava respectées : données affichées uniquement à l'athlète qui les fournit,
// aucune donnée Strava stockée (lecture à la volée), aucune donnée Strava envoyée à une IA,
// logo « Powered by Strava » et liens « Voir sur Strava ».

const AUTH = "https://www.strava.com/oauth";
const API = "https://www.strava.com/api/v3";

export function authorizeUrl({ clientId, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state,
  });
  return `${AUTH}/authorize?${q}`;
}

async function token(form) {
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error(j.message === "Bad Request" && JSON.stringify(j.errors || "").includes("limit") ? "Limite d'athlètes de l'app Strava atteinte" : `Strava a refusé la connexion (${r.status})`);
    e.code = r.status;
    throw e;
  }
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: j.expires_at * 1000, athleteId: j.athlete?.id, firstname: j.athlete?.firstname };
}

export const exchangeCode = ({ clientId, clientSecret, code }) =>
  token({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" });
export const refresh = ({ clientId, clientSecret, refreshToken }) =>
  token({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });

export async function deauthorize(accessToken) {
  await fetch(`${AUTH}/deauthorize`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
}

export async function listActivities(accessToken, afterEpoch) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${API}/athlete/activities?after=${afterEpoch}&per_page=200&page=${page}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status === 401) { const e = new Error("Strava : connexion expirée"); e.code = 401; throw e; }
    if (r.status === 429) { const e = new Error("Strava : trop de requêtes, réessaie dans 15 minutes"); e.code = 429; throw e; }
    if (!r.ok) throw new Error(`Strava : erreur ${r.status}`);
    const batch = await r.json();
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}
