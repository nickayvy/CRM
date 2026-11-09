import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadGraph } from "@/features/lookup/data";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/lookup/graph → `{ nodes: GraphNode[], links: {source,target}[] }` for the signed-in user. */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  try {
    const body = await loadGraph(getDb());
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("lookup graph failed", err);
    return NextResponse.json({ message: "Graph failed" }, { status: 500 });
  }
}
