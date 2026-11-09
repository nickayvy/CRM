import type { CsvColumn } from "@/lib/export-csv";
import { toCsv } from "@/lib/export-csv";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import type { LeadRow } from "./types";

/** Export columns (WP-15): name, phone, website, category, city, rating, reviews, l30d, status, notes. */
export const LEAD_CSV_COLUMNS: CsvColumn<LeadRow>[] = [
  { header: "Name", accessor: (l) => l.name },
  { header: "Phone", accessor: (l) => l.phone },
  { header: "Website", accessor: (l) => l.website },
  { header: "Category", accessor: (l) => l.category },
  { header: "City", accessor: (l) => l.city },
  { header: "Rating", accessor: (l) => (l.rating === null ? null : l.rating.toFixed(1)) },
  { header: "Reviews", accessor: (l) => l.reviews },
  { header: "L30D", accessor: (l) => l.l30d },
  { header: "Status", accessor: (l) => LEAD_STATUS_LABELS[l.status].label },
  { header: "Notes", accessor: (l) => l.notes },
];

/** One row per lead, in the given (visible) order. */
export function buildLeadsCsv(rows: LeadRow[]): string {
  return toCsv(LEAD_CSV_COLUMNS, rows);
}

export function leadsCsvFilename(now: Date = new Date()): string {
  return `leads-${now.toISOString().slice(0, 10)}.csv`;
}
