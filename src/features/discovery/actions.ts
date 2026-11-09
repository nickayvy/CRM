// Discovery entry points for pages and components (architecture §Discovery).
// The three server actions live in ./server-actions ("use server"); this module
// re-exports them next to the synchronous discoveryConfigured().
import { env } from "@/lib/env";

export { enrichTrustpilotAction, scrapeUrlAction, seedCategoryAction } from "./server-actions";
export type { SeedQueued } from "./server-actions";
export { DISCOVERY_NOT_CONFIGURED } from "@/lib/firecrawl/client";

/** True when FIRECRAWL_API_KEY is set (call on the server; the key is never sent to the client). */
export function discoveryConfigured(): boolean {
  return !!env.FIRECRAWL_API_KEY;
}
