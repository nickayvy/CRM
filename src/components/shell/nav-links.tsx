"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS, isActive } from "./nav-items";

export function NavLinks({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        const link = (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? label : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-dense font-medium transition-colors",
              collapsed && "justify-center px-0",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} aria-hidden />
            {collapsed ? null : <span className="truncate">{label}</span>}
          </Link>
        );
        if (!collapsed) return link;
        return (
          <Tooltip key={href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
