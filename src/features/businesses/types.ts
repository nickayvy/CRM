import type { Business } from "@/db/schema";

/** The business fields the table renders. A full `Business` satisfies it. */
export type BusinessRow = Pick<
  Business,
  | "id"
  | "source"
  | "name"
  | "score"
  | "qualification"
  | "rejectionReasons"
  | "status"
  | "categories"
  | "primaryCategory"
  | "city"
  | "state"
  | "rating"
  | "reviewCount"
  | "reviewsLast30d"
  | "phone"
  | "displayPhone"
  | "lastContactedAt"
  | "doNotCall"
  | "tags"
>;

export function toBusinessRow(b: Business): BusinessRow {
  return {
    id: b.id,
    source: b.source,
    name: b.name,
    score: b.score,
    qualification: b.qualification,
    rejectionReasons: b.rejectionReasons,
    status: b.status,
    categories: b.categories,
    primaryCategory: b.primaryCategory,
    city: b.city,
    state: b.state,
    rating: b.rating,
    reviewCount: b.reviewCount,
    reviewsLast30d: b.reviewsLast30d,
    phone: b.phone,
    displayPhone: b.displayPhone,
    lastContactedAt: b.lastContactedAt,
    doNotCall: b.doNotCall,
    tags: b.tags,
  };
}
