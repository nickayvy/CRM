"use client";

import Link from "next/link";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/primitives/kbd";
import { NavLinks } from "./nav-links";
import { useSidebarCollapsed, useSidebarShortcut } from "./use-sidebar";

export function BrandMark() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-2xs font-bold text-primary-foreground">
      LB
    </span>
  );
}

/** Desktop sidebar (≥ md). Collapses to an icon rail; `[` toggles; state persists in localStorage. */
export function Sidebar() {
  const [collapsed, toggle] = useSidebarCollapsed();
  useSidebarShortcut(toggle);
  return (
    <aside
      data-slot="sidebar"
      data-collapsed={collapsed || undefined}
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className={cn("flex h-12 items-center border-b", collapsed ? "justify-center px-2" : "px-3")}>
        <Link href="/" aria-label="Local Business CRM, dashboard" className="flex min-w-0 items-center gap-2 rounded-md">
          <BrandMark />
          {collapsed ? null : <span className="truncate text-sm font-semibold tracking-tight">Local Business CRM</span>}
        </Link>
      </div>
      <div className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-2.5")}>
        <NavLinks collapsed={collapsed} />
      </div>
      <div className={cn("flex border-t p-2", collapsed ? "justify-center" : "justify-end")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              aria-keyshortcuts="["
              data-testid="sidebar-toggle"
            >
              {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand sidebar" : "Collapse sidebar"} <Kbd className="text-foreground">[</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
