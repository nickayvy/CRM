import { createHmac, timingSafeEqual } from "node:crypto";

// WP-12 bridge: env.ts no longer exposes the v1 gate variables. WP-11 deletes
// this module (and the gate) in the same wave; until then read them directly.
const env = {
  get APP_PASSWORD() {
    return process.env.APP_PASSWORD?.trim() || undefined;
  },
  get APP_SESSION_SECRET() {
    return process.env.APP_SESSION_SECRET?.trim() || "dev-insecure-session-secret-change-me";
  },
};

/** Cookie holding HMAC-SHA256(APP_SESSION_SECRET, APP_PASSWORD). */
export const SESSION_COOKIE = "crm_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

/** The gate is active only when APP_PASSWORD is set. */
export function isAuthActive(): boolean {
  return Boolean(env.APP_PASSWORD);
}

export function sessionToken(password: string, secret: string = env.APP_SESSION_SECRET): string {
  return createHmac("sha256", secret).update(password).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** True when the gate is inactive or the cookie value matches the expected token. */
export function isValidSession(cookieValue: string | undefined): boolean {
  const password = env.APP_PASSWORD;
  if (!password) return true;
  if (!cookieValue) return false;
  return safeEqual(cookieValue, sessionToken(password));
}

export function checkPassword(candidate: string): boolean {
  const password = env.APP_PASSWORD;
  if (!password) return false;
  return safeEqual(sessionToken(candidate), sessionToken(password));
}

/** Only allow same-site relative redirect targets. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}
