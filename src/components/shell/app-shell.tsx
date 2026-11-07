import Link from "next/link";
import { LogOutIcon } from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { isAuthActive } from "@/lib/auth";
import { MobileNav } from "./mobile-nav";
import { ShellGate } from "./shell-gate";
import { BrandMark, Sidebar } from "./sidebar";
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

function MobileBrand() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
      <BrandMark />
      <span className="truncate">Local Business CRM</span>
    </Link>
  );
}

/**
 * Application chrome: collapsible sidebar on ≥ md (`[` toggles, persisted),
 * sheet drawer below; top bar with the
 * command palette, theme toggle and (when the password gate is active) logout.
 * /login renders without the chrome.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const authActive = isAuthActive();
  return (
    <ShellGate bare={children}>
      <div className="flex min-h-svh w-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur md:px-4">
            <MobileNav />
            <div className="min-w-0 md:hidden">
              <MobileBrand />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <CommandPalette />
              <ThemeToggle />
              {authActive ? <LogoutButton /> : null}
            </div>
          </header>
          <main className="min-w-0 flex-1 px-4 py-5 md:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </ShellGate>
  );
}
