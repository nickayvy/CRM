import {
  BuildingIcon,
  LayoutDashboardIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/businesses", label: "Businesses", icon: BuildingIcon },
  { href: "/searches", label: "Searches", icon: SearchIcon },
  { href: "/calling", label: "Calling", icon: PhoneIcon },
  { href: "/email", label: "Email", icon: MailIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
