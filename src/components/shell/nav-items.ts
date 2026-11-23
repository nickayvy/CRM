import { GitBranchIcon, LayoutDashboardIcon, LayoutGridIcon, MailIcon, PhoneIcon, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** Top-bar navigation, in order: home first, then the workflow from finding a business to contacting it. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "OVERVIEW", icon: LayoutDashboardIcon },
  { href: "/lookup", label: "LOOKUP", icon: LayoutGridIcon },
  { href: "/leads", label: "LEADS", icon: GitBranchIcon },
  { href: "/calling", label: "CALLING", icon: PhoneIcon },
  { href: "/email", label: "EMAIL", icon: MailIcon },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
