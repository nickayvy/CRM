import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_PAGES, HOME_PATH, SUPABASE_ANON_KEY, SUPABASE_URL, isPublicPath, supabaseConfigured } from "./config";

/**
 * Runs in the proxy on every matched request: refreshes the Supabase session
 * cookies, sends signed-out users to /login (API routes get a 401 instead)
 * and signed-in users away from /login and /signup. Exempt: /login, /signup,
 * /api/auth/*, /api/cron/*. Without Supabase env every user is signed out.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { pathname, search } = request.nextUrl;

  let signedIn = false;
  if (supabaseConfigured()) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    // getUser() (not getSession()) revalidates the token with Supabase Auth.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  }

  if (signedIn && AUTH_PAGES.some((p) => pathname === p)) {
    return redirectKeepingCookies(request, response, new URL(HOME_PATH, request.url));
  }

  if (signedIn || isPublicPath(pathname)) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/" && pathname !== HOME_PATH) url.searchParams.set("next", pathname + search);
  return redirectKeepingCookies(request, response, url);
}

/** 307 redirect that carries over any refreshed session cookies. */
function redirectKeepingCookies(request: NextRequest, from: NextResponse, to: URL): NextResponse {
  const res = NextResponse.redirect(to, 307);
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}
