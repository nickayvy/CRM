import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Searches" };

export default function Page() {
  return <PlaceholderPage title="Searches" wp="WP-04" />;
}
