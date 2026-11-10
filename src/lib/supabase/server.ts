import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "./config";

/** Cookie-backed Supabase client for server components, server actions and route handlers. */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component, where cookies are read-only. The
          // proxy (updateSession) refreshes the session on every request.
        }
      },
    },
  });
}

export type AuthUser = { id: string; email: string | null };

/**
 * The signed-in user, or null (also null when Supabase is not configured).
 * Memoised per request, so the shell and the page can both ask.
 *
 * The proxy (`updateSession`) has already revalidated the session with
 * Supabase Auth on this same request, so here the token is verified locally
 * with `getClaims()` (signature against the project's cached JWKS) instead of
 * a second network round trip. Projects on a symmetric JWT secret make
 * `getClaims()` call Auth itself, and any failure falls back to `getUser()`,
 * so the result is never weaker than before.
 */
export const getUser: () => Promise<AuthUser | null> = cache(async () => {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = !error ? data?.claims?.sub : undefined;
    if (typeof sub === "string" && sub) {
      const email = data?.claims?.email;
      return { id: sub, email: typeof email === "string" && email ? email : null };
    }
  } catch {
    // fall through to the network check
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
});

/** The signed-in user; redirects to /login when there is none. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
