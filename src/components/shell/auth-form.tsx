"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

const COPY: Record<
  Mode,
  { title: string; description: string; submit: string; busy: string; footer: string; footerLink: string; footerHref: string }
> = {
  login: {
    title: "Sign In",
    description: "Enter your credentials to access the platform",
    submit: "Sign In",
    busy: "Signing in...",
    footer: "Don't have an account?",
    footerLink: "Sign up",
    footerHref: "/signup",
  },
  signup: {
    title: "Create Account",
    description: "Sign up to start discovering leads",
    submit: "Sign Up",
    busy: "Creating account...",
    footer: "Already have an account?",
    footerLink: "Sign in",
    footerHref: "/login",
  },
};

/** Leadwire email + password card (ported from gtm's login/signup forms). */
export function AuthForm({ mode, next = "/lookup", notice }: { mode: Mode; next?: string; notice?: string }) {
  const copy = COPY[mode];
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
      });
      if (error) throw error;
      if (data.session) {
        // Email confirmation disabled in the project: already signed in.
        router.replace("/lookup");
        router.refresh();
        return;
      }
      toast.success("Check your email to confirm your account");
      router.push("/login");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <Card
      className="card-glow gap-0 rounded-lg border border-white/5 bg-surface-elevated py-0 shadow-[var(--shadow-elevated)] ring-0"
      data-testid={`${mode}-card`}
    >
      <CardHeader className="px-6 py-5">
        <CardTitle className="font-serif text-2xl font-normal tracking-tight">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4 px-6 py-5">
          {notice ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 6 : undefined}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 border-t-0 bg-transparent px-6 py-5">
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? copy.busy : copy.submit}
          </Button>
          <p className="text-sm text-muted-foreground">
            {copy.footer}{" "}
            <Link href={copy.footerHref} className="text-primary hover:underline">
              {copy.footerLink}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
