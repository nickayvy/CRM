import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Email" };

export default function Page() {
  return <PlaceholderPage title="Email" wp="WP-06" />;
}
