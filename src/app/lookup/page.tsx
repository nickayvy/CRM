import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Lookup" };

export default async function LookupPage() {
  await requireUser();
  return <PlaceholderPage title="Lookup" description="Business network, discovery and dossiers." wp="WP-14" />;
}
