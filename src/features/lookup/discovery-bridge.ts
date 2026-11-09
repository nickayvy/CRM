// Discovery entry points used by the Lookup UI, re-exported from WP-13's modules
// (frozen signatures in docs/team/v2/architecture.md §Discovery). Wired at merge by the PM.
export { scrapeUrlAction, seedCategoryAction, discoveryConfigured } from "@/features/discovery/actions";
export { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";
