"use client";

import { usePathname } from "next/navigation";

const BARE_ROUTES = ["/login"];

/** Renders `bare` (the page alone) on chrome-less routes, otherwise the full shell. */
export function ShellGate({ bare, children }: { bare: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  return BARE_ROUTES.includes(pathname) ? <>{bare}</> : <>{children}</>;
}
