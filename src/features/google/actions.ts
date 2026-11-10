// Google Maps search entry points for pages and components (architecture
// §Actions and routes). The four server actions live in ./server-actions
// ("use server"); this module re-exports them next to the synchronous
// googleConfigured().
import { env } from "@/lib/env";

export {
  continueGoogleSearchAction,
  previewGoogleSearchAction,
  rerunGoogleSearchAction,
  startGoogleSearchAction,
} from "./server-actions";
export type { GooglePreview } from "./server-actions";
export { GOOGLE_NOT_CONFIGURED } from "@/lib/google-places/client";

/** True when GOOGLE_PLACES_API_KEY is set (call on the server; the key never reaches the client). */
export function googleConfigured(): boolean {
  return !!env.GOOGLE_PLACES_API_KEY;
}
