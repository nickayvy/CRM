// Serializable view models for /leads (server page → client components).
import type { CallOutcome, CampaignStatus, LeadStatus } from "@/db/schema";
import type { LeadWithBusiness } from "@/db/repo/leads";

/** A call campaign a lead's business is queued in. */
export type LeadCampaignRef = { id: string; name: string };

export type LeadRow = {
  id: string;
  businessId: string;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
  name: string;
  phone: string | null;
  website: string | null;
  email: string | null;
  category: string | null;
  city: string | null;
  rating: number | null;
  reviews: number;
  l30d: number;
  /** Call campaigns this lead is queued in (absent or empty: not queued anywhere). */
  callCampaigns?: LeadCampaignRef[];
};

export type CallHistoryRow = {
  id: string;
  businessId: string;
  businessName: string;
  outcome: CallOutcome | null;
  agent: string | null;
  notes: string;
  occurredAt: string;
  /** Relative time computed on the server at render ("3 h ago"). */
  relative: string;
};

export type CampaignTarget = { id: string; name: string; status: CampaignStatus };

export type LeadMetricsData = { total: number; queued: number; success: number; calls7d: number };

/** Human category: first category title, else the primary category alias. */
export function leadCategory(b: LeadWithBusiness["business"]): string | null {
  const title = b.categories?.[0]?.title?.trim();
  return title || b.primaryCategory?.trim() || null;
}

export function toLeadRow(l: LeadWithBusiness, callCampaigns?: LeadCampaignRef[]): LeadRow {
  const b = l.business;
  const rating = b.rating === null ? null : Number(b.rating);
  return {
    id: l.id,
    businessId: l.businessId,
    status: l.status,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
    name: b.name,
    phone: b.phone,
    website: b.website,
    email: b.ownerEmail ?? b.email,
    category: leadCategory(b),
    city: b.city,
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    reviews: b.reviewCount,
    l30d: b.reviewsLast30d,
    ...(callCampaigns?.length ? { callCampaigns } : {}),
  };
}

/** Pipeline filter tabs. "contacted" also shows callbacks (both mean "spoken to / attempted"). */
export const LEAD_TAB_FILTERS = [
  { value: "all", label: "All", statuses: null },
  { value: "queued", label: "Queued", statuses: ["queued"] },
  { value: "contacted", label: "Contacted", statuses: ["contacted", "callback"] },
  { value: "success", label: "Success", statuses: ["success"] },
  { value: "failed", label: "Failed", statuses: ["failed"] },
] as const satisfies readonly { value: string; label: string; statuses: readonly LeadStatus[] | null }[];

export type LeadTab = (typeof LEAD_TAB_FILTERS)[number]["value"];

export type LeadFilterState = { tab: LeadTab; search: string; category: string | null };

/** Client-side pipeline filter: status tab, then category, then name/phone search. */
export function filterLeads(rows: LeadRow[], f: LeadFilterState): LeadRow[] {
  const tab = LEAD_TAB_FILTERS.find((t) => t.value === f.tab);
  const statuses: readonly LeadStatus[] | null = tab?.statuses ?? null;
  const q = f.search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  return rows.filter((r) => {
    if (statuses && !statuses.includes(r.status)) return false;
    if (f.category && r.category !== f.category) return false;
    if (q) {
      const nameHit = r.name.toLowerCase().includes(q);
      const phoneHit = qDigits.length > 0 && (r.phone ?? "").replace(/\D/g, "").includes(qDigits);
      if (!nameHit && !phoneHit) return false;
    }
    return true;
  });
}
