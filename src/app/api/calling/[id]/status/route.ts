import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { evaluateCampaign, getCallCampaign, getCampaignStats } from "@/db/repo/call-campaigns";
import type { CampaignStatusPayload } from "@/features/calling/types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Polled by the campaign page every 5 s: evaluates, then returns status + queue stats. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const db = getDb();
    if (!(await getCallCampaign(db, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
    const now = new Date();
    const c = await evaluateCampaign(db, id, now);
    const stats = await getCampaignStats(db, id, now);
    const body: CampaignStatusPayload = {
      campaign: {
        id: c.id,
        name: c.name,
        status: c.status,
        pauseReason: c.pauseReason,
        dailyCap: c.dailyCap,
        updatedAt: c.updatedAt,
      },
      stats,
      at: now.toISOString(),
    };
    return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/calling/status] failed", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
