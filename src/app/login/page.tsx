import Link from "next/link";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAuthActive, safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  const error = sp.error === "1";
  const active = isAuthActive();

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <LockIcon className="size-5" aria-hidden />
          </div>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {active ? "Enter the workspace password to continue." : "No password is configured; the app is open."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {active ? (
            <form action="/api/auth/login" method="post" className="grid gap-4">
              <input type="hidden" name="next" value={next} />
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                  aria-invalid={error || undefined}
                  aria-describedby={error ? "password-error" : undefined}
                />
                {error ? (
                  <p id="password-error" className="text-sm text-destructive">
                    Incorrect password.
                  </p>
                ) : null}
              </div>
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          ) : (
            <Button asChild className="w-full">
              <Link href="/">Go to dashboard</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
