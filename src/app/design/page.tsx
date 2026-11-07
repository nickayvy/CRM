import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Design system" };

export default function Page() {
  return <PlaceholderPage title="Design system" wp="WP-02" />;
}
