// Discovery entry points used by the Lookup UI (WP-14), against WP-13's frozen
// signatures in docs/team/v2/architecture.md §Discovery.
//
// TODO(PM, at WP-13 merge): `@/features/discovery/actions` and
// `@/lib/trustpilot-categories` did not exist when WP-14 was built, so this
// module points at local stubs. At merge replace the body with:
//   export { scrapeUrlAction, seedCategoryAction, discoveryConfigured } from "@/features/discovery/actions";
//   export { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";
// and delete discovery-stub-actions.ts and trustpilot-categories.ts here.
// Callers `await discoveryConfigured()`, so a sync or async real version both work.
export { scrapeUrlAction, seedCategoryAction } from "./discovery-stub-actions";
export { TRUSTPILOT_CATEGORIES } from "./trustpilot-categories";

/** Stub: discovery is never configured until WP-13's real check (`!!env.FIRECRAWL_API_KEY`) replaces it. */
export function discoveryConfigured(): boolean {
  return false;
}
