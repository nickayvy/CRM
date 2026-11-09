import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/placeholder-page";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  await requireUser();
  return <PlaceholderPage title="Leads" description="Your lead pipeline and call history." wp="WP-15" />;
}
