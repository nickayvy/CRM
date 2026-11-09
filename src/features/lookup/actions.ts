"use server";

import { getDb } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import { addLead } from "@/db/repo/leads";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { requireUser } from "@/lib/supabase/server";
import { type Dossier, loadDossier } from "./data";

/**
 * Adds the business to the signed-in user's lead list (idempotent). The user
 * always comes from `requireUser()`, never from the client.
 */
export async function addToLeadsAction(businessId: string): Promise<ActionResult<{ created: boolean }>> {
  const user = await requireUser();
  const db = getDb();
  if (typeof businessId !== "string" || !(await getBusiness(db, businessId))) return fail("Business not found");
  try {
    const { created } = await addLead(db, user.id, businessId);
    return ok({ created });
  } catch (err) {
    console.error("addToLeadsAction failed", err);
    return fail("Could not add the lead");
  }
}

/** The dossier for one business and its similar companies; null data when it does not exist. */
export async function getDossierAction(businessId: string): Promise<ActionResult<Dossier>> {
  await requireUser();
  if (typeof businessId !== "string") return fail("Business not found");
  const dossier = await loadDossier(getDb(), businessId);
  return dossier ? ok(dossier) : fail("Business not found");
}
