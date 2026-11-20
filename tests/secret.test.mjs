// Sans SESSION_SECRET : la clé est générée une fois, stockée, puis réutilisée.
import assert from "node:assert/strict";
delete process.env.SESSION_SECRET;
const mem = new Map();
globalThis.__FDJ_STORE = { get: async (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : null), setJSON: async (k, v) => mem.set(k, JSON.stringify(v)), delete: async (k) => mem.delete(k) };
const { default: handler } = await import("../netlify/functions/api.mjs");
const r = await handler(new Request("https://x.example/api/signup", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
assert.equal(r.status, 200, await r.clone().text());
const key = JSON.parse(mem.get("config/secret")).value;
assert.equal(key.length, 64);
const cookie = r.headers.get("set-cookie").split(";")[0];
const me = await handler(new Request("https://x.example/api/me", { headers: { cookie } }));
assert.equal(me.status, 200);
assert.equal(JSON.parse(mem.get("config/secret")).value, key, "la clé a changé");
console.log("OK clé générée automatiquement");
