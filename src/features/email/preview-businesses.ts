import type { Db } from "@/db/client";
import { listBusinesses } from "@/db/repo/businesses";
import type { PreviewBusiness } from "./components/campaign-form";

/** Businesses with an email, trimmed to the fields templates read, for the steps editor's preview select. */
export async function loadPreviewBusinesses(db: Db, limit = 100): Promise<PreviewBusiness[]> {
  const { rows } = await listBusinesses(db, { hasEmail: true }, { sort: { field: "name", dir: "asc" }, limit });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    ownerName: b.ownerName,
    city: b.city,
    state: b.state,
    primaryCategory: b.primaryCategory,
    rating: b.rating,
    reviewCount: b.reviewCount,
    displayPhone: b.displayPhone,
    phone: b.phone,
  }));
}

/** Parse `EMAIL_FROM` ("Name <addr>" or "addr") into form defaults. */
export function parseFrom(from: string): { fromName: string; fromEmail: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { fromName: m[1].replace(/^"|"$/g, ""), fromEmail: m[2].trim() };
  return { fromName: "", fromEmail: from.trim() };
}
