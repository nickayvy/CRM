import type { Business } from "@/db/schema";

/** The business fields the table renders. A full `Business` satisfies it. */
export type BusinessRow = Pick<
  Business,
  | "id"
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
  | "phone"
  | "displayPhone"
  | "lastContactedAt"
  | "doNotCall"
  | "tags"
>;

export function toBusinessRow(b: Business): BusinessRow {
  return {
    id: b.id,
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
    phone: b.phone,
    displayPhone: b.displayPhone,
    lastContactedAt: b.lastContactedAt,
    doNotCall: b.doNotCall,
    tags: b.tags,
  };
}
