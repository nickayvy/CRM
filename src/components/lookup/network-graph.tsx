"use client";

import { useCallback, useEffect, useRef } from "react";
import * as d3 from "d3";
import { Search } from "lucide-react";
import type { GraphNode } from "@/db/repo/discovery";
import { ACCENT_COLOR, categoryColor, hasLabel, nodeRadius, truncateLabel } from "@/features/lookup/graph-utils";
import type { GraphLink } from "@/features/lookup/types";

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode };

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Canonical category order so node colors match the bubbles. */
  categoryOrder: readonly string[];
  onNodeClick: (id: string) => void;
  onNodeHover: (node: GraphNode | null, x: number, y: number) => void;
  /** Hint under the empty-state title (e.g. the FIRECRAWL_API_KEY notice). */
  emptyHint?: string;
};

const radius = (d: SimNode) => nodeRadius(d.totalReviews);

/**
 * d3 v7 force graph (gtm network-graph.tsx): radius by reviews, colors by
 * category, dashed links with arrowheads, labels for big nodes, zoom
 * [0.1, 8], drag, hover accent, ResizeObserver re-centering.
 */
export function NetworkGraph({ nodes, links, categoryOrder, onNodeClick, onNodeHover, emptyHint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeHoverRef = useRef(onNodeHover);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
    onNodeHoverRef.current = onNodeHover;
  }, [onNodeClick, onNodeHover]);

  const getSize = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width || 600, height: rect?.height || 400 };
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (nodes.length === 0 || !svgEl) {
      simulationRef.current?.stop();
      simulationRef.current = null;
      return;
    }
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    const { width, height } = getSize();
    svg.attr("width", width).attr("height", height);

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const simLinks: SimLink[] = links.map((l) => ({ ...l }));
    const color = (d: SimNode) => categoryColor(d.category, categoryOrder);

    svg
      .append("defs")
      .append("marker")
      .attr("id", "lookup-arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#6b7280");

    const g = svg.append("g");
    // While a node is being dragged, trackpads keep emitting wheel events
    // (a resting second finger, scroll momentum). d3-zoom would read those as
    // a slow zoom, so zoom input is ignored — and the page kept from
    // scrolling — until the drag ends.
    let draggingNode = false;
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 8])
        // d3-zoom's default filter, plus the drag guard.
        .filter((event: MouseEvent) => !draggingNode && (!event.ctrlKey || event.type === "wheel") && !event.button)
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr("transform", event.transform.toString());
        }),
    );
    svg.on(
      "wheel.drag-guard",
      (event: WheelEvent) => {
        if (draggingNode) event.preventDefault();
      },
      { passive: false },
    );

    const link = g
      .append("g")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#4b5563")
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.35)
      .attr("stroke-dasharray", "4,4")
      .attr("marker-end", "url(#lookup-arrowhead)");

    const node = g
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(simNodes)
      .join("circle")
      .attr("data-node-id", (d) => d.id)
      .attr("r", radius)
      .attr("fill", color)
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.9)
      .attr("fill-opacity", 0.85)
      .attr("cursor", "pointer");

    const labels = g
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(simNodes.filter((d) => hasLabel(d.totalReviews)))
      .join("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => radius(d) + 12)
      .attr("font-size", "9px")
      .attr("fill", "#94a3b8")
      .attr("pointer-events", "none")
      .text((d) => truncateLabel(d.name));

    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .velocityDecay(0.7)
      .alphaDecay(0.05)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(180),
      )
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius((d) => radius(d) + 16));
    simulationRef.current = simulation;

    node.call(
      d3
        .drag<SVGCircleElement, SimNode>()
        .on("start", (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d) => {
          draggingNode = true;
          if (!event.active) simulation.alphaTarget(0.05).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>, d) => {
          draggingNode = false;
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    node.on("click", (_event: MouseEvent, d) => onNodeClickRef.current(d.id));
    node.on("mouseover", (event: MouseEvent, d) => {
      onNodeHoverRef.current(d, event.clientX, event.clientY);
      d3.select(event.currentTarget as SVGCircleElement)
        .attr("stroke", ACCENT_COLOR)
        .attr("stroke-width", 2.5)
        .attr("stroke-opacity", 1)
        .attr("fill-opacity", 1);
    });
    node.on("mouseout", (event: MouseEvent, d) => {
      onNodeHoverRef.current(null, 0, 0);
      d3.select(event.currentTarget as SVGCircleElement)
        .attr("stroke", color(d))
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.9)
        .attr("fill-opacity", 0.85);
    });

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      labels.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
      onNodeHoverRef.current(null, 0, 0);
    };
  }, [nodes, links, categoryOrder, getSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const svg = svgRef.current;
      if (!svg) return;
      const { width, height } = getSize();
      d3.select(svg).attr("width", width).attr("height", height);
      simulationRef.current?.force("center", d3.forceCenter(width / 2, height / 2)).alpha(0.1).restart();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [getSize]);

  if (nodes.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full min-h-64 w-full items-center justify-center p-6" data-testid="graph-empty">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Search className="h-7 w-7 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold">No businesses yet</h3>
            <p className="max-w-[260px] text-sm text-muted-foreground">
              {emptyHint ?? "Paste a Trustpilot URL or seed a category to start building your network"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full min-h-64 w-full overflow-hidden bg-[#151518]" data-testid="network-graph">
      <svg ref={svgRef} className="h-full w-full" role="img" aria-label={`Business network, ${nodes.length} businesses`} />
    </div>
  );
}
