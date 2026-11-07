import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getSearchJob } from "@/db/repo/search-jobs";

export const dynamic = "force-dynamic";

/** GET the search job as JSON (polled by /searches/[id] while pending/running). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getSearchJob(getDb(), id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
