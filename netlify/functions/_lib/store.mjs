// Stockage (Netlify Blobs), session signée et chiffrement des jetons.
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET manquant (32 caractères minimum)");
  return s;
};
const key = () => crypto.createHash("sha256").update("enc:" + SECRET()).digest();

export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function decrypt(str) {
  if (!str) return null;
  const [iv, tag, data] = str.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}

const sign = (v) => crypto.createHmac("sha256", SECRET()).update(v).digest("base64url");
export function sessionCookie(userId) {
  const v = `${userId}.${sign(userId)}`;
  return `fdj=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
}
export const clearCookie = "fdj=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
export function userIdFromRequest(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)fdj=([^;]+)/);
  if (!m) return null;
  const [id, sig] = m[1].split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export const newId = () => crypto.randomBytes(12).toString("base64url");
export const hash = (s) => crypto.createHash("sha256").update(SECRET() + ":" + s).digest("hex");
export function newRecoveryCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.randomBytes(12);
  const raw = [...b].map((x) => a[x % a.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
export function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// globalThis.__FDJ_STORE permet aux tests d'utiliser un stockage en mémoire.
const store = () => globalThis.__FDJ_STORE || getStore({ name: "le-finisher", consistency: "strong" });
export const db = {
  get: (k) => store().get(k, { type: "json" }),
  set: (k, v) => store().setJSON(k, v),
  del: (k) => store().delete(k),
};
export const users = {
  get: (id) => db.get(`users/${id}`),
  save: (u) => db.set(`users/${u.id}`, { ...u, updatedAt: Date.now() }),
  remove: (id) => db.del(`users/${id}`),
};
