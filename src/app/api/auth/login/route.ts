import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, checkPassword, isAuthActive, safeNextPath, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Form POST from /login (works without JS and with curl). 303 → next path on success, /login?error=1 otherwise. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));

  if (!isAuthActive()) return NextResponse.redirect(new URL(next, request.url), 303);

  if (!checkPassword(password)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "1");
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }

  const res = NextResponse.redirect(new URL(next, request.url), 303);
  res.cookies.set(SESSION_COOKIE, sessionToken(process.env.APP_PASSWORD!.trim()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
