// Call script tokens. Client-safe (the dialer fills them in the browser).
import type { Business } from "@/db/schema";
import { formatPhone, formatRating } from "@/lib/format";

export const SCRIPT_TOKENS = [
  { token: "business_name", description: "Business name" },
  { token: "owner_first_name", description: "Owner's first name" },
  { token: "city", description: "City" },
  { token: "category", description: "Primary category" },
  { token: "rating", description: "Yelp rating, e.g. 4.5" },
  { token: "review_count", description: "Number of Yelp reviews" },
  { token: "agent", description: "Your name (the agent)" },
] as const;

type ScriptBusiness = Pick<
  Business,
  "name" | "ownerName" | "city" | "state" | "categories" | "primaryCategory" | "rating" | "reviewCount" | "phone"
>;

/** Token → value for one business; null when the business has no value. */
export function tokenValues(b: ScriptBusiness, agent?: string | null): Record<string, string | null> {
  const first = b.ownerName?.trim().split(/\s+/)[0] ?? null;
  const category = b.categories?.[0]?.title ?? b.primaryCategory ?? null;
  return {
    business_name: b.name,
    owner_first_name: first || null,
    owner_name: b.ownerName?.trim() || null,
    city: b.city ?? null,
    state: b.state ?? null,
    category,
    rating: b.rating === null || b.rating === undefined ? null : formatRating(b.rating),
    review_count: String(b.reviewCount ?? 0),
    phone: b.phone ? formatPhone(b.phone) : null,
    agent: agent?.trim() || null,
  };
}

// Characters that would change markdown structure if they appeared inside a value.
const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|<>~]/g;

/**
 * Replaces `{{token}}` with markdown-escaped values. Missing values become a
 * visible `[owner first name]` placeholder so the agent knows to ad-lib;
 * unknown tokens are left as written.
 */
export function fillScript(script: string, b: ScriptBusiness, agent?: string | null): string {
  const values = tokenValues(b, agent);
  return script.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, raw: string) => {
    const key = raw.toLowerCase();
    if (!(key in values)) return whole;
    const v = values[key];
    if (v === null) return `\\[${key.replace(/_/g, " ")}\\]`;
    return v.replace(MD_SPECIAL, (c) => `\\${c}`);
  });
}
