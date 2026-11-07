import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return <PlaceholderPage title="Dashboard" wp="WP-07" />;
}
