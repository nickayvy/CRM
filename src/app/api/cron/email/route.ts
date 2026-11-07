import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { processAllDue } from "@/db/repo/email-campaigns";
import { createEmailSender } from "@/lib/email/sender";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true; // open when unset (local only)
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron: send every due email step across running campaigns. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sent = await processAllDue(getDb(), createEmailSender(env));
    return Response.json({ sent });
  } catch (err) {
    console.error("[cron/email] failed:", err);
    return Response.json({ error: "Email run failed" }, { status: 500 });
  }
}
