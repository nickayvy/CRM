import { type NextRequest, NextResponse } from "next/server";
import { safeNextPath, supabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Supabase email-confirmation / magic-link landing: exchanges `?code=` for a
 * session cookie, then redirects to `?next=` (same-site only, default /lookup).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code && supabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url), 307);
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("error", "auth_callback_error");
  return NextResponse.redirect(url, 307);
}
