import { getDb, closeDb } from "@/db/client";
import { listCallCampaigns } from "@/db/repo/call-campaigns";
const db = getDb();
(async () => {
  try { await listCallCampaigns(db); console.log("ok"); }
  catch (e) { const err = e as Error & { cause?: Error & Record<string, unknown>; query?: string; params?: unknown[] }; console.log("MESSAGE:", err.message.slice(0, 600)); console.log("PARAMS:", JSON.stringify(err.params)); console.log("CAUSE:", err.cause?.message, JSON.stringify({ code: err.cause?.code, position: err.cause?.position, hint: err.cause?.hint, detail: err.cause?.detail })); }
  await closeDb(); process.exit(0);
})();
