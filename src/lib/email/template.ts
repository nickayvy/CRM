import type { Business } from "@/db/schema";
import { formatPhone } from "@/lib/format";

/** The business fields personalization tokens read. A full `Business` satisfies it. */
export type TemplateBusiness = Pick<
  Business,
  "name" | "ownerName" | "city" | "state" | "primaryCategory" | "rating" | "reviewCount" | "displayPhone" | "phone"
>;

/** Documented personalization tokens, in display order, with a short description for the token help. */
export const TEMPLATE_TOKENS = [
  { token: "business_name", description: "Business name" },
  { token: "owner_first_name", description: "Owner's first name (blank if unknown)" },
  { token: "owner_name", description: "Owner's full name" },
  { token: "city", description: "City" },
  { token: "state", description: "State" },
  { token: "category", description: "Primary category" },
  { token: "rating", description: "Yelp rating, e.g. 4.5" },
  { token: "review_count", description: "Number of Yelp reviews" },
  { token: "phone", description: "Phone number" },
] as const;

export type TemplateToken = (typeof TEMPLATE_TOKENS)[number]["token"];

function tokenValues(b: TemplateBusiness): Record<TemplateToken, string> {
  const owner = b.ownerName?.trim() ?? "";
  return {
    business_name: b.name,
    owner_first_name: owner ? owner.split(/\s+/)[0] : "",
    owner_name: owner,
    city: b.city ?? "",
    state: b.state ?? "",
    category: b.primaryCategory ?? "",
    rating: b.rating ?? "",
    review_count: String(b.reviewCount ?? 0),
    phone: b.displayPhone || formatPhone(b.phone),
  };
}

/**
 * Replace `{{token}}` placeholders (whitespace inside the braces allowed) with
 * the business's values. Unknown tokens render as ''.
 */
export function renderTemplate(tpl: string, b: TemplateBusiness): string {
  const values: Record<string, string> = tokenValues(b);
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    Object.hasOwn(values, key) ? values[key] : "",
  );
}
