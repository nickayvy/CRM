// Global search for the command palette (WP-07).
import { asc, desc, ilike, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { type Business, type CallCampaign, type EmailCampaign, businesses, callCampaigns, emailCampaigns } from "../schema";

export type SearchResults = { businesses: Business[]; callCampaigns: CallCampaign[]; emailCampaigns: EmailCampaign[] };

/** Longest query we search on; anything after is ignored. */
export const MAX_QUERY_LENGTH = 100;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Case-insensitive substring search. Businesses match on name, city, or phone
 * digits (when the query holds at least 3 digits, so "713555" and
 * "(713) 555" both match); campaigns match on name. Each group returns at
 * most `limit` rows (default 8): businesses by score then name, campaigns
 * newest first. An empty query returns empty groups.
 */
export async function searchAll(db: Db, q: string, limit = 8): Promise<SearchResults> {
  const query = q.trim().slice(0, MAX_QUERY_LENGTH);
  const n = Math.max(0, Math.min(Math.floor(limit), 50));
  if (!query || n === 0) return { businesses: [], callCampaigns: [], emailCampaigns: [] };
  const like = `%${escapeLike(query)}%`;
  const digits = query.replace(/\D/g, "");

  const [b, c, e] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(
        or(
          ilike(businesses.name, like),
          ilike(businesses.city, like),
          digits.length >= 3 ? sql`${businesses.phoneDigits} LIKE ${`%${digits}%`}` : undefined,
        ),
      )
      .orderBy(desc(businesses.score), asc(businesses.name), asc(businesses.id))
      .limit(n),
    db
      .select()
      .from(callCampaigns)
      .where(ilike(callCampaigns.name, like))
      .orderBy(desc(callCampaigns.createdAt), asc(callCampaigns.id))
      .limit(n),
    db
      .select()
      .from(emailCampaigns)
      .where(ilike(emailCampaigns.name, like))
      .orderBy(desc(emailCampaigns.createdAt), asc(emailCampaigns.id))
      .limit(n),
  ]);
  return { businesses: b, callCampaigns: c, emailCampaigns: e };
}
