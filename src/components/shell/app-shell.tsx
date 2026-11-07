import Link from "next/link";
import { LogOutIcon } from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { isAuthActive } from "@/lib/auth";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { ShellGate } from "./shell-gate";
import { ThemeToggle } from "./theme-toggle";

function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <Button type="submit" variant="ghost" size="icon" aria-label="Log out">
        <LogOutIcon className="size-4" aria-hidden />
      </Button>
    </form>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
        LB
      </span>
      <span className="truncate">Local Business CRM</span>
    </Link>
  );
}

/**
 * Application chrome: sidebar on ≥ md, sheet drawer below; top bar with the
 * command palette, theme toggle and (when the password gate is active) logout.
 * /login renders without the chrome.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const authActive = isAuthActive();
  return (
    <ShellGate bare={children}>
      <div className="flex min-h-svh w-full">
        <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex h-14 items-center border-b px-4">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <NavLinks />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <MobileNav />
            <div className="min-w-0 md:hidden">
              <Brand />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <CommandPalette />
              <ThemeToggle />
              {authActive ? <LogoutButton /> : null}
            </div>
          </header>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </ShellGate>
  );
}
