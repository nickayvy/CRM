import { CommandPalette } from "@/components/command-palette";
import { getUser } from "@/lib/supabase/server";
import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { ShellGate } from "./shell-gate";
import { TopNav } from "./top-nav";
import { TOPBAR_CLASS } from "./topbar-class";
import { UserMenu } from "./user-menu";

/**
 * Leadwire chrome: a single 80 px top bar (brand · five nav items · command
 * palette + user menu) over a scrolling `main.main-depth`. Below lg the nav
 * collapses into a Menu dropdown. /login and /signup render without it.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  return <ShellGate bare={children}>{<Chrome>{children}</Chrome>}</ShellGate>;
}

async function Chrome({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <div className="flex h-svh flex-col overflow-hidden" data-slot="app-shell">
      <header className={`${TOPBAR_CLASS} relative z-30`} data-testid="topbar">
        <div className="flex min-w-0 flex-1 items-center">
          <Brand href="/lookup" />
        </div>
        <TopNav />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <CommandPalette />
          <UserMenu email={user?.email ?? null} />
          <MobileNav />
        </div>
      </header>
      <main id="main" className="main-depth min-w-0 flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
