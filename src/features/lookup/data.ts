// Server-side loaders for /lookup and GET /api/lookup/graph. Take a Db so
// tests can run them against PGlite.
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness, listBusinesses } from "@/db/repo/businesses";
import { businesses } from "@/db/schema";
import { type GraphNode, listGraphNodes, listRelations, relatedBusinesses } from "@/db/repo/discovery";
import { TRUSTPILOT_CATEGORIES } from "./discovery-bridge";
import { PAGE_SIZE, type LookupQuery } from "./search-params";
import { type GraphLink, type LookupBusiness, toLookupBusiness } from "./types";

/** Nodes for the network (the client subsets to the top 50) and the relations among them. */
export async function loadGraph(db: Db): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const [nodes, relations] = await Promise.all([listGraphNodes(db, 1000), listRelations(db)]);
  const ids = new Set(nodes.map((n) => n.id));
  const links = relations.filter((l) => ids.has(l.source) && ids.has(l.target));
  return { nodes, links };
}

/** One 50-row grid page, most reviews first (gtm order). */
export async function loadGrid(db: Db, q: LookupQuery): Promise<{ rows: LookupBusiness[]; total: number }> {
  const { rows, total } = await listBusinesses(db, q.filter, {
    sort: { field: "reviewCount", dir: "desc" },
    limit: PAGE_SIZE,
    offset: q.offset,
  });
  return { rows: rows.map(toLookupBusiness), total };
}

export type Dossier = { business: LookupBusiness; related: LookupBusiness[] };

export async function loadDossier(db: Db, id: string): Promise<Dossier | null> {
  const business = await getBusiness(db, id);
  if (!business) return null;
  const related = await relatedBusinesses(db, id);
  return { business: toLookupBusiness(business), related: related.map(toLookupBusiness) };
}

type TitleRow = { alias: string; title: string };

/**
 * Display title per category alias, from the rows' `categories` jsonb
 * ({alias,title}) with the 22 Trustpilot labels as a fallback.
 */
export async function loadCategoryTitles(db: Db): Promise<Record<string, string>> {
  const res = await db.execute<TitleRow>(
    sql`SELECT DISTINCT ON (c->>'alias') c->>'alias' AS alias, c->>'title' AS title FROM ${businesses}, jsonb_array_elements(${businesses.categories}) AS c WHERE coalesce(c->>'title', '') <> '' ORDER BY c->>'alias', c->>'title'`,
  );
  const rows = Array.isArray(res) ? (res as TitleRow[]) : ((res as { rows?: TitleRow[] }).rows ?? []);
  const out: Record<string, string> = Object.fromEntries(TRUSTPILOT_CATEGORIES.map((c) => [c.slug, c.label]));
  for (const r of rows) if (r.alias && r.title) out[r.alias] = r.title;
  return out;
}
