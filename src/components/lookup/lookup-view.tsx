"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GraphNode } from "@/db/repo/discovery";
import { DISCOVERY_DISABLED_HINT } from "@/features/lookup/copy";
import { categoryOrder as orderOf, graphSubset } from "@/features/lookup/graph-utils";
import { hrefFor, patchLookupParams } from "@/features/lookup/search-params";
import type { GraphLink } from "@/features/lookup/types";
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

type LookupCtx = { select: (id: string) => void };
const LookupContext = createContext<LookupCtx>({ select: () => {} });

/** Opens the dossier for a business from anywhere inside `LookupView` (grid cards). */
export function useLookupSelect(): (id: string) => void {
  return useContext(LookupContext).select;
}

type Props = {
  graph: { nodes: GraphNode[]; links: GraphLink[] };
  categories: { alias: string; count: number }[];
  discoveryEnabled: boolean;
  /** The grid panel body (server-rendered, suspended per query). */
  children: React.ReactNode;
};

/**
 * Client shell of /lookup (gtm lookup page): 30 % network panel · flex-5 grid
 * panel · flex-2 filter panel, stacked below lg with the network collapsible.
 */
export function LookupView({ graph, categories, discoveryEnabled, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const selectedCategory = searchParams.get("category");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ node: GraphNode | null; x: number; y: number }>({ node: null, x: 0, y: 0 });
  const [graphOpen, setGraphOpen] = useState(false);

  const order = useMemo(() => orderOf(graph.nodes), [graph.nodes]);
  const subset = useMemo(
    () => graphSubset(graph.nodes, graph.links, { category: selectedCategory }),
    [graph.nodes, graph.links, selectedCategory],
  );

  const select = useCallback((id: string) => setSelectedId(id), []);
  const ctx = useMemo(() => ({ select }), [select]);
  const onHover = useCallback((node: GraphNode | null, x: number, y: number) => setTooltip({ node, x, y }), []);
  const onCategory = useCallback(
    (category: string | null) => router.push(hrefFor(pathname, patchLookupParams(qs, { category })), { scroll: false }),
    [router, pathname, qs],
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
              <CategoryBubbles nodes={graph.nodes} order={order} selectedCategory={selectedCategory} onCategoryClick={onCategory} />
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
          <div className={cn("flex min-w-0 flex-col overflow-hidden lg:flex-[5]", PANEL)} data-testid="grid-panel">
            <div className="flex shrink-0 justify-center border-b border-white/5 px-4 py-4 sm:px-6">
              <div className="w-full max-w-xl">
                <ManualScrapeInput enabled={discoveryEnabled} onSuccess={() => router.refresh()} />
              </div>
            </div>
            {children}
          </div>
          <div className={cn("order-first flex min-w-0 flex-col overflow-hidden lg:order-none lg:flex-[2]", PANEL)}>
            <FilterPanel categories={categories} />
          </div>
        </div>

        <DossierModal businessId={selectedId} onClose={() => setSelectedId(null)} />
      </div>
    </LookupContext.Provider>
  );
}
