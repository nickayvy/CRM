import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { evaluateAllCampaigns } from "@/db/repo/call-campaigns";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron: re-evaluates every running/paused call campaign (auto pause/resume/complete). */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const evaluated = await evaluateAllCampaigns(getDb());
    return NextResponse.json({ evaluated });
  } catch (err) {
    console.error("[cron/campaigns] failed", err);
    return NextResponse.json({ error: "evaluation failed" }, { status: 500 });
  }
}
