import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";

export const LOCAL_DEV_AUTH_MODE = "local-founder";
export const LOCAL_DEV_SUBJECT = "local-dev-founder";
export const LOCAL_DEV_EMAIL = "itachi@ayamai.io";
const COOKIE_NAME = "ayamai_local_dev";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
// One public origin, plus the loopback names, so the door's name is configuration.
const PUBLIC_ORIGIN = (process.env.AYAMAI_PUBLIC_ORIGIN ?? "http://ayamai.local").replace(/\/+$/, "");
const PUBLIC_PORT = Number(process.env.AYAMAI_PORT ?? 80);
const ALLOWED_ORIGINS = new Set([
  PUBLIC_ORIGIN,
  "http://localhost:25222",
  "http://127.0.0.1:25222",
  `http://localhost:${PUBLIC_PORT}`,
  `http://127.0.0.1:${PUBLIC_PORT}`,
]);
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip", "cf-ray"];

declare global {
  namespace Express {
    interface Request { ayamaiDevUserId?: string; }
  }
}

export function localFounderModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AYAMAI_DEV_AUTH_MODE === LOCAL_DEV_AUTH_MODE;
}

export function assertLocalDevAuthConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  const mode = env.AYAMAI_DEV_AUTH_MODE;
  if (mode && mode !== "clerk" && mode !== LOCAL_DEV_AUTH_MODE) throw new Error("AYAMAI_DEV_AUTH_MODE must be 'clerk' or 'local-founder'.");
  if (!localFounderModeEnabled(env)) return;
  if (env.NODE_ENV === "production") throw new Error("Local founder authentication is unavailable in production.");
  if (env.NODE_ENV !== "development" || env.HOST !== "127.0.0.1") throw new Error("Local founder authentication requires a development server bound to 127.0.0.1.");
  let database: URL;
  try { database = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("Local founder authentication requires the isolated local database."); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "127.0.0.1" ||
      database.port !== "5434" || database.pathname !== "/ayamai_local") {
    throw new Error("Local founder authentication requires 127.0.0.1:5434/ayamai_local.");
  }
  if (env.APP_OWNER_EMAIL) throw new Error("APP_OWNER_EMAIL cannot be used with the isolated local founder identity.");
  if ((env.CLERK_PUBLISHABLE_KEY && !env.CLERK_PUBLISHABLE_KEY.startsWith("pk_test_")) ||
      (env.CLERK_SECRET_KEY && !env.CLERK_SECRET_KEY.startsWith("sk_test_"))) {
    throw new Error("Local founder authentication only accepts optional Clerk development keys.");
  }
  if (Object.keys(env).some((name) => /^(?:AWS_|R2_|CLOUDFLARE_)/.test(name) && env[name])) {
    throw new Error("Local founder authentication cannot run with cloud media credentials configured.");
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "localhost") return true;
  if (normalized.startsWith("::ffff:")) return isLoopbackAddress(normalized.slice(7));
  const parts = normalized.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function hasProxyHeaders(req: Request): boolean {
  return PROXY_HEADERS.some((name) => req.headers[name] !== undefined);
}
function cookieValue(req: Request): string | undefined {
  return req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}

export function createLocalFounderAuth(secret = randomBytes(32)) {
  const sign = (payload: string) => createHmac("sha256", secret).update(payload).digest();
  function makeSession(now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ sub: LOCAL_DEV_SUBJECT, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
    return `${payload}.${sign(payload).toString("base64url")}`;
  }
  function verifySession(token: string | undefined, now = Date.now()): boolean {
    if (!token) return false;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return false;
    let supplied: Buffer;
    let parsed: unknown;
    try {
      supplied = Buffer.from(signature, "base64url");
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch { return false; }
    const expected = sign(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || !parsed || typeof parsed !== "object") return false;
    const session = parsed as { sub?: unknown; exp?: unknown };
    return session.sub === LOCAL_DEV_SUBJECT && typeof session.exp === "number" &&
      Number.isSafeInteger(session.exp) && session.exp > Math.floor(now / 1000);
  }
  const middleware: RequestHandler = (req, _res, next) => {
    if (!localFounderModeEnabled()) { next(); return; }
    const valid = isLoopbackAddress(req.socket.remoteAddress) && !hasProxyHeaders(req) && verifySession(cookieValue(req));
    req.ayamaiDevUserId = valid ? LOCAL_DEV_SUBJECT : undefined;
    next();
  };
  const createSession: RequestHandler = (req, res) => {
    if (!localFounderModeEnabled()) { res.sendStatus(404); return; }
    if (!isLoopbackAddress(req.socket.remoteAddress) || hasProxyHeaders(req) || !ALLOWED_ORIGINS.has(req.get("Origin") ?? "")) {
      res.status(403).set("Cache-Control", "private, no-store").json({ error: "Local developer session is unavailable." });
      return;
    }
    const token = makeSession();
    res.set({
      "Cache-Control": "private, no-store",
      "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`,
    });
    res.json({ userId: LOCAL_DEV_SUBJECT, displayName: "Itachi", email: LOCAL_DEV_EMAIL });
  };
  return { middleware, createSession, makeSession, verifySession };
}

export function requestUserId(req: Request): string | null {
  if (localFounderModeEnabled()) return req.ayamaiDevUserId ?? null;
  return getAuth(req).userId;
}
