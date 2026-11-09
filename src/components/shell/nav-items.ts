import { GitBranchIcon, LayoutDashboardIcon, LayoutGridIcon, MailIcon, PhoneIcon, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** Top-bar navigation, in order. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/lookup", label: "LOOKUP", icon: LayoutGridIcon },
  { href: "/leads", label: "LEADS", icon: GitBranchIcon },
  { href: "/calling", label: "CALLING", icon: PhoneIcon },
  { href: "/email", label: "EMAIL", icon: MailIcon },
  { href: "/overview", label: "OVERVIEW", icon: LayoutDashboardIcon },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
