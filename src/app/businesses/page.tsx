import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Businesses" };

export default function Page() {
  return <PlaceholderPage title="Businesses" wp="WP-04" />;
}
