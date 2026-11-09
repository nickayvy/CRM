// NEXT_PUBLIC_* vars are inlined at build time only when referenced literally,
// so these two reads must stay exactly `process.env.NEXT_PUBLIC_…`.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** False when either value is missing (local dev without Supabase, CI builds). */
export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Pages reachable without a session; a signed-in user is bounced away from them. */
export const AUTH_PAGES = ["/login", "/signup"] as const;
/** Route prefixes reachable without a session. Cron routes do their own CRON_SECRET check. */
export const PUBLIC_PREFIXES = ["/api/auth/", "/api/cron/"] as const;
export const HOME_PATH = "/lookup";

export function isPublicPath(pathname: string): boolean {
  return (
    AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/** Only same-site relative redirect targets; anything else falls back to the home path. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return HOME_PATH;
  if (AUTH_PAGES.some((p) => next === p || next.startsWith(`${p}?`) || next.startsWith(`${p}/`))) return HOME_PATH;
  return next;
}
