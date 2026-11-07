import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { searchAll } from "@/db/repo/search";

export const dynamic = "force-dynamic";

export type SearchHit = { id: string; title: string; subtitle: string; href: string };
export type SearchResponse = { businesses: SearchHit[]; callCampaigns: SearchHit[]; emailCampaigns: SearchHit[] };

/** GET /api/search?q= — command palette results (≤ 8 per group). Behind the password gate like every page. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const r = await searchAll(getDb(), q, 8);
    const body: SearchResponse = {
      businesses: r.businesses.map((b) => ({
        id: b.id,
        title: b.name,
        subtitle: [[b.city, b.state].filter(Boolean).join(", "), b.displayPhone ?? b.phone ?? ""].filter(Boolean).join(" · "),
        href: `/businesses/${b.id}`,
      })),
      callCampaigns: r.callCampaigns.map((c) => ({ id: c.id, title: c.name, subtitle: c.status, href: `/calling/${c.id}` })),
      emailCampaigns: r.emailCampaigns.map((c) => ({ id: c.id, title: c.name, subtitle: c.status, href: `/email/${c.id}` })),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("search failed", err);
    return NextResponse.json({ message: "Search failed" }, { status: 500 });
  }
}
