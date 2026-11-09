import type { Metadata } from "next";
import { AuthForm } from "@/components/shell/auth-form";
import { AuthFrame } from "@/components/shell/auth-frame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthFrame>
      <AuthForm mode="signup" />
    </AuthFrame>
  );
}
