import type { Metadata } from "next";
import { AuthForm } from "@/components/shell/auth-form";
import { AuthFrame } from "@/components/shell/auth-frame";
import { safeNextPath } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  const notice =
    sp.error === "auth_callback_error" ? "That confirmation link is invalid or has expired. Sign in or sign up again." : undefined;
  return (
    <AuthFrame>
      <AuthForm mode="login" next={next} notice={notice} />
    </AuthFrame>
  );
}
