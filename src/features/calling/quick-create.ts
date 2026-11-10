// Name-only campaign creation for the "New campaign" option of the
// add-to-campaign dialogs (dossier and /leads). Everything else keeps the
// schema defaults and can be changed later under the campaign's Settings.
import type { Db } from "@/db/client";
import { createCallCampaign } from "@/db/repo/call-campaigns";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { env } from "@/lib/env";

export const QUICK_CAMPAIGN_NAME_MAX = 120;

/** A draft, people-dialed campaign in the app time zone. */
export async function quickCreateCallCampaign(db: Db, rawName: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return fail("Name the campaign.");
  if (name.length > QUICK_CAMPAIGN_NAME_MAX) return fail(`Keep the name under ${QUICK_CAMPAIGN_NAME_MAX} characters.`);
  const c = await createCallCampaign(db, { name, status: "draft", mode: "human", timezone: env.APP_TIMEZONE });
  return ok({ id: c.id, name: c.name });
}
