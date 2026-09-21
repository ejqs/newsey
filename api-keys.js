import crypto from "node:crypto";

/** Token format: rose_<16-hex-id>_<64-hex-secret>. Only the SHA-256 of the full token is stored. */
export const TOKEN_RE = /^rose_([a-f0-9]{16})_([a-f0-9]{64})$/;
export const DEFAULT_SCOPES = "bot:read bot:command";
export const SCOPE_READ = "bot:read";
export const SCOPE_COMMAND = "bot:command";

export const API_KEYS_SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
`;

export function generateToken() {
  const id = crypto.randomBytes(8).toString("hex");
  const secret = crypto.randomBytes(32).toString("hex");
  const token = `rose_${id}_${secret}`;
  return {
    id,
    prefix: `rose_${id}`,
    token,
    secretHash: hashToken(token),
  };
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function parseToken(token) {
  if (!token || typeof token !== "string") return null;
  const m = token.trim().match(TOKEN_RE);
  if (!m) return null;
  return { id: m[1], secret: m[2] };
}

export function hashesEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function hasScope(scopes, needed) {
  const set = new Set(String(scopes || "").split(/\s+/).filter(Boolean));
  return set.has(needed);
}

export function bearerFromRequest(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const header =
    req.headers["x-rose-key"] || req.headers["x-rose-token"] || "";
  return bearer || String(header).trim();
}
