// Sans variables Netlify : Strava et le code d'invitation se règlent dans l'appli.
import assert from "node:assert/strict";
for (const k of ["SESSION_SECRET", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "INVITE_CODE"]) delete process.env[k];
const mem = new Map();
globalThis.__FDJ_STORE = { get: async (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : null), setJSON: async (k, v) => mem.set(k, JSON.stringify(v)), delete: async (k) => mem.delete(k) };
const { default: handler } = await import("../netlify/functions/api.mjs");
const jar = {};
const call = async (who, path, method = "GET", body) => {
  const r = await handler(new Request("https://le-finisher.netlify.app/api" + path, { method, headers: { cookie: jar[who] || "", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
  return { status: r.status, j: await r.json().catch(() => null), loc: r.headers.get("location") };
};
await call("jeremy", "/signup", "POST", {});
let me = (await call("jeremy", "/me")).j;
assert.equal(me.stravaAvailable, false); assert.equal(me.adminClaimable, true);
assert.equal((await call("jeremy", "/admin/claim", "POST")).status, 200);
const a = await call("jeremy", "/admin", "POST", { stravaId: "12345", stravaSecret: "s3cr3t", invite: "FINISHER2027" });
assert.equal(a.j.callbackDomain, "le-finisher.netlify.app"); assert.equal(a.j.hasStravaSecret, true);
assert.ok(!JSON.stringify([...mem.values()]).includes("s3cr3t"), "secret Strava stocké en clair");
me = (await call("jeremy", "/me")).j;
assert.equal(me.stravaAvailable, true); assert.equal(me.inviteRequired, true); assert.equal(me.isAdmin, true);
const c = await call("jeremy", "/strava/connect"); assert.ok(c.loc.includes("client_id=12345"));
// Un pote : invitation exigée, pas admin
assert.equal((await call("pote", "/signup", "POST", { invite: "faux" })).status, 403);
assert.equal((await call("pote", "/signup", "POST", { invite: "FINISHER2027" })).status, 200);
assert.equal((await call("pote", "/admin", "POST", { invite: "" })).status, 403);
assert.equal((await call("pote", "/admin")).j.stravaId, null, "le Client ID ne doit pas fuiter");
console.log("OK administration dans l'appli");
