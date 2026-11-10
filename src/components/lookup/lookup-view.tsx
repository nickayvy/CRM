"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GraphNode } from "@/db/repo/discovery";
import { addToLeadsAction } from "@/features/lookup/actions";
import { DISCOVERY_DISABLED_HINT } from "@/features/lookup/copy";
import { categoryOrder as orderOf, graphSubset } from "@/features/lookup/graph-utils";
import { categoryParam, hrefFor, parseCategories, patchLookupParams, toggleCategory } from "@/features/lookup/search-params";
import type { CampaignTarget } from "@/features/leads/types";
import type { GraphLink, LookupBusiness } from "@/features/lookup/types";
import { cn } from "@/lib/utils";
import { CategoryBubbles } from "./category-bubbles";
import { DossierModal } from "./dossier-modal";
import { FilterPanel } from "./filter-panel";
import { GraphTooltip } from "./graph-tooltip";
import { ManualScrapeInput } from "./manual-scrape-input";
import { NetworkGraph } from "./network-graph";

const GRAPH_TITLE = "Business network";
const GRAPH_HELP =
  "Each circle is a business. Size reflects review volume; color matches category. Lines show relationships between businesses. Click a node to open its dossier; drag nodes to rearrange. Use the scroll wheel or pinch to zoom.";

const PANEL = "rounded-lg bg-surface-elevated shadow-[var(--shadow-elevated)]";

const NO_LEADS: ReadonlySet<string> = new Set();

type LookupCtx = {
  /** Opens the dossier; pass the row already on screen so it shows at once. */
  select: (id: string, preview?: LookupBusiness) => void;
  /** Business ids on the signed-in user's lead list. */
  leadIds: ReadonlySet<string>;
  /** Business ids with an add-to-leads request in flight. */
  addingIds: ReadonlySet<string>;
  /** Adds the business to the lead list; null outside `LookupView`. */
  addLead: ((business: { id: string; name: string }) => void) | null;
  /** Filter/page navigation that marks the grid busy until the new page arrives; null outside `LookupView`. */
  navigate: ((href: string) => void) | null;
};
const LookupContext = createContext<LookupCtx>({ select: () => {}, leadIds: NO_LEADS, addingIds: NO_LEADS, addLead: null, navigate: null });

/** Opens the dossier for a business from anywhere inside `LookupView` (grid cards). */
export function useLookupSelect(): LookupCtx["select"] {
  return useContext(LookupContext).select;
}

/** Lead state, add-to-leads and busy-aware navigation for islands inside `LookupView`. */
export function useLookup(): LookupCtx {
  return useContext(LookupContext);
}

/** After seeding a category the rows land over about a minute: pull them in without a manual refresh. */
const SEED_REFRESH_MS = [8_000, 20_000, 40_000, 65_000];

type Props = {
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  categories: { alias: string; count: number }[];
  /** alias → display title for bubbles and the category filter. */
  categoryTitles: Record<string, string>;
  discoveryEnabled: boolean;
  /** Business ids already on the signed-in user's lead list. */
  leadBusinessIds?: string[];
  /** Open call campaigns a new lead can be queued in straight from the dossier. */
  callCampaigns?: CampaignTarget[];
  /** The grid panel body (server-rendered, suspended per query). */
  children: React.ReactNode;
};

/**
 * Client shell of /lookup (gtm lookup page): 30 % network panel · flex-5 grid
 * panel · flex-2 filter panel, stacked below lg with the network collapsible.
 */
/** Cheap identity for a graph payload: same nodes (and sizes) and the same number of links. */
function graphSignature(g: Props["graph"]): string {
  let sig = `${g.nodes.length}:${g.links.length}`;
  for (const n of g.nodes) sig += `|${n.id}:${n.totalReviews}`;
  return sig;
}

export function LookupView({ graph: incoming, categories, categoryTitles, discoveryEnabled, leadBusinessIds, callCampaigns, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const categoryValue = searchParams.get("category");
  const selectedCategories = useMemo(() => parseCategories(categoryValue), [categoryValue]);

  // Every filter or page click re-sends the graph. Keep the object we already
  // have while its content is unchanged, so the force layout is not torn down
  // and re-simulated each time.
  const [graph, setGraph] = useState(incoming);
  const [seenGraph, setSeenGraph] = useState(incoming);
  if (seenGraph !== incoming) {
    setSeenGraph(incoming);
    if (graphSignature(incoming) !== graphSignature(graph)) setGraph(incoming);
  }

  const [selected, setSelected] = useState<{ id: string; preview: LookupBusiness | null } | null>(null);
  const [navPending, startNav] = useTransition();
  // Leads added in this visit, on top of what the server rendered.
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(NO_LEADS);
  const [addingIds, setAddingIds] = useState<ReadonlySet<string>>(NO_LEADS);
  const leadIds = useMemo<ReadonlySet<string>>(
    () => (leadBusinessIds?.length || addedIds.size ? new Set([...(leadBusinessIds ?? []), ...addedIds]) : NO_LEADS),
    [leadBusinessIds, addedIds],
  );
  const [tooltip, setTooltip] = useState<{ node: GraphNode | null; x: number; y: number }>({ node: null, x: 0, y: 0 });
  const [graphOpen, setGraphOpen] = useState(false);

  const order = useMemo(() => orderOf(graph.nodes), [graph.nodes]);
  const subset = useMemo(
    () => graphSubset(graph.nodes, graph.links, { categories: selectedCategories }),
    [graph.nodes, graph.links, selectedCategories],
  );

  const select = useCallback((id: string, preview?: LookupBusiness) => setSelected({ id, preview: preview ?? null }), []);
  const navigate = useCallback((href: string) => startNav(() => router.push(href, { scroll: false })), [router]);
  const markLead = useCallback((id: string) => setAddedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  const addLead = useCallback(
    (business: { id: string; name: string }) => {
      setAddingIds((prev) => new Set(prev).add(business.id));
      const done = () =>
        setAddingIds((prev) => {
          const next = new Set(prev);
          next.delete(business.id);
          return next;
        });
      addToLeadsAction(business.id).then(
        (res) => {
          done();
          if (!res.ok) {
            toast.error("Failed to add lead", { description: res.message ?? "Unknown error" });
            return;
          }
          markLead(business.id);
          const opts = { description: business.name, action: { label: "View leads", onClick: () => router.push("/leads") } };
          if (res.data.created) toast.success("Lead added", opts);
          else toast.info("Already in your leads", opts);
        },
        () => {
          done();
          toast.error("Failed to add lead", { description: "Check your connection and try again." });
        },
      );
    },
    [markLead, router],
  );
  const ctx = useMemo(() => ({ select, leadIds, addingIds, addLead, navigate }), [select, leadIds, addingIds, addLead, navigate]);

  const seedTimers = useRef<number[]>([]);
  useEffect(() => () => seedTimers.current.forEach((t) => window.clearTimeout(t)), []);
  const onDiscovered = useCallback(() => {
    router.refresh();
    seedTimers.current.forEach((t) => window.clearTimeout(t));
    seedTimers.current = SEED_REFRESH_MS.map((ms) => window.setTimeout(() => router.refresh(), ms));
  }, [router]);
  const onHover = useCallback((node: GraphNode | null, x: number, y: number) => setTooltip({ node, x, y }), []);
  const onCategory = useCallback(
    (category: string | null) => {
      const next = category === null ? [] : toggleCategory(selectedCategories, category);
      navigate(hrefFor(pathname, patchLookupParams(qs, { category: categoryParam(next) })));
    },
    [navigate, pathname, qs, selectedCategories],
  );

  return (
    <LookupContext.Provider value={ctx}>
      <div className="flex min-w-0 flex-col gap-4 p-4 lg:h-full lg:flex-row" data-testid="lookup-view">
        <div className={cn("relative flex min-w-0 flex-col overflow-hidden lg:w-[30%]", PANEL)} data-testid="graph-panel">
          <div className="shrink-0 border-b border-white/10 bg-[#151518] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-200">{GRAPH_TITLE}</h3>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:text-slate-200 focus:ring-2 focus:ring-slate-500 focus:outline-none"
                      aria-label="What is this graph?"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" sideOffset={8} className="max-w-[240px] px-3 py-2 text-xs leading-relaxed">
                    {GRAPH_HELP}
                  </TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  className="rounded p-0.5 text-slate-400 hover:text-slate-200 lg:hidden"
                  aria-expanded={graphOpen}
                  aria-controls="lookup-graph-body"
                  aria-label={graphOpen ? "Hide network" : "Show network"}
                  onClick={() => setGraphOpen((o) => !o)}
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform duration-300 ease-out", !graphOpen && "-rotate-90")} />
                </button>
              </div>
            </div>
          </div>
          <div
            id="lookup-graph-body"
            data-open={graphOpen}
            className={cn("min-h-0 flex-1 flex-col", graphOpen ? "flex" : "hidden", "lg:flex")}
          >
            <div className="shrink-0 bg-[#151518]">
              <CategoryBubbles nodes={graph.nodes} order={order} selectedCategories={selectedCategories} titles={categoryTitles} onCategoryClick={onCategory} />
            </div>
            <div className="relative h-72 min-h-0 lg:h-auto lg:flex-1">
              <NetworkGraph
                nodes={subset.nodes}
                links={subset.links}
                categoryOrder={order}
                onNodeClick={select}
                onNodeHover={onHover}
                emptyHint={discoveryEnabled ? undefined : `Paste a Trustpilot URL or seed a category to start. ${DISCOVERY_DISABLED_HINT}.`}
              />
            </div>
          </div>
          <GraphTooltip node={tooltip.node} x={tooltip.x} y={tooltip.y} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
          <div
            className={cn("relative flex min-w-0 flex-col overflow-hidden lg:flex-[5]", PANEL)}
            data-testid="grid-panel"
            aria-busy={navPending || undefined}
          >
            {navPending && (
              <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15" data-testid="grid-busy" role="status" aria-label="Loading results">
                <div className="h-full w-1/3 animate-[lookup-busy_1s_ease-in-out_infinite] bg-primary" />
              </div>
            )}
            <div className="flex shrink-0 justify-center border-b border-white/5 px-4 py-4 sm:px-6">
              <div className="w-full max-w-xl">
                <ManualScrapeInput enabled={discoveryEnabled} onSuccess={() => router.refresh()} onSeeded={onDiscovered} />
              </div>
            </div>
            <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity duration-200", navPending && "pointer-events-none opacity-50")}>
              {children}
            </div>
          </div>
          <div className={cn("order-first flex min-w-0 flex-col overflow-hidden lg:order-none lg:flex-[2]", PANEL)}>
            <FilterPanel categories={categories} titles={categoryTitles} onNavigate={navigate} />
          </div>
        </div>

        <DossierModal
          businessId={selected?.id ?? null}
          preview={selected?.preview ?? null}
          leadIds={leadIds}
          onLeadAdded={markLead}
          callCampaigns={callCampaigns}
          onClose={() => setSelected(null)}
          onDeleted={() => router.refresh()}
        />
      </div>
    </LookupContext.Provider>
  );
}
