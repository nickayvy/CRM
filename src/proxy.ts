import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isAuthActive, isValidSession } from "@/lib/auth";

// Paths reachable without a session. Cron routes do their own CRON_SECRET check.
const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/api/cron/"];

export function proxy(request: NextRequest) {
  if (!isAuthActive()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  if (isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
