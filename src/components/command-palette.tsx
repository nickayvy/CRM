"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  BuildingIcon,
  GitBranchIcon,
  KeyboardIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  LoaderIcon,
  MailIcon,
  PaletteIcon,
  PhoneIcon,
  SearchIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { modKey, ShortcutsDialog } from "@/components/shell/shortcuts-dialog";
import type { SearchHit, SearchResponse } from "@/app/api/search/route";

export const PAGES: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/lookup", label: "Lookup", icon: LayoutGridIcon },
  { href: "/leads", label: "Leads", icon: GitBranchIcon },
  { href: "/calling", label: "Calling", icon: PhoneIcon },
  { href: "/email", label: "Email", icon: MailIcon },
  { href: "/overview", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/design", label: "Design", icon: PaletteIcon },
];

const EMPTY: SearchResponse = { businesses: [], callCampaigns: [], emailCampaigns: [] };
export const SEARCH_DEBOUNCE_MS = 150;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "combobox";
}

const noopSubscribe = () => () => {};

/**
 * Debounced fetch of `/api/search`; stale responses are dropped. `loading`
 * is true from the keystroke until results for the current query arrive.
 */
function useSearch(query: string) {
  const [settled, setSettled] = useState<{ q: string; body: SearchResponse }>({ q: "", body: EMPTY });
  const seq = useRef(0);
  const q = query.trim();
  useEffect(() => {
    const id = ++seq.current;
    if (!q) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      let body = EMPTY;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: "no-store" });
        if (res.ok) body = (await res.json()) as SearchResponse;
      } catch {
        if (ctrl.signal.aborted) return;
      }
      if (id === seq.current) setSettled({ q, body });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  if (!q) return { results: EMPTY, loading: false };
  return { results: settled.q === q ? settled.body : EMPTY, loading: settled.q !== q };
}

function HitGroup({ heading, hits, icon: Icon, onPick }: { heading: string; hits: SearchHit[]; icon: LucideIcon; onPick: (href: string) => void }) {
  if (hits.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {hits.map((h) => (
        <CommandItem key={h.id} value={`${heading}:${h.id}`} onSelect={() => onPick(h.href)}>
          <Icon aria-hidden />
          <span className="min-w-0 truncate">{h.title}</span>
          {h.subtitle ? <span className="ml-auto shrink-0 truncate pl-2 text-xs text-muted-foreground">{h.subtitle}</span> : null}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/**
 * Global Cmd/Ctrl+K palette: pages, businesses (name / phone / city) and
 * campaigns, searched server-side with a 150 ms debounce. Also owns the `?`
 * shortcut that opens the keyboard-shortcuts help.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { results, loading } = useSearch(open ? query : "");
  const mod = useSyncExternalStore(noopSubscribe, modKey, () => "⌘");

  const setPaletteOpen = useCallback((o: boolean) => {
    setOpen(o);
    if (!o) setQuery("");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((o) => {
          if (o) setQuery("");
          return !o;
        });
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(false);
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on the next tick: closing synchronously inside cmdk's Enter keydown
  // returns focus to the trigger button, which then receives the same
  // Enter's keypress as a click and reopens the palette.
  const closeSoon = () => setTimeout(() => setPaletteOpen(false), 0);
  const go = (href: string) => {
    router.push(href);
    closeSoon();
  };

  const q = query.trim().toLowerCase();
  const pages = q ? PAGES.filter((p) => p.label.toLowerCase().includes(q)) : PAGES;
  const hasHits = results.businesses.length + results.callCampaigns.length + results.emailCampaigns.length > 0;
  const showHelpItem = !q || "keyboard shortcuts help".includes(q);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        data-testid="command-palette-trigger"
      >
        <SearchIcon className="size-4" aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline" suppressHydrationWarning>
          {mod === "⌘" ? "⌘K" : "Ctrl K"}
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setPaletteOpen}
        title="Search"
        description="Search businesses and campaigns, or jump to a page."
        className="sm:max-w-xl"
      >
        {/* Filtering is ours: pages are filtered locally, hits already come filtered from the server. */}
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search businesses, phones, cities, campaigns…"
            aria-label="Search"
            data-testid="command-palette-input"
          />
          <CommandList className="max-h-[min(60svh,420px)]">
            {pages.length === 0 && !hasHits && !showHelpItem ? (
              <CommandEmpty>{loading ? "Searching…" : "No results."}</CommandEmpty>
            ) : null}
            <HitGroup heading="Businesses" hits={results.businesses} icon={BuildingIcon} onPick={go} />
            <HitGroup heading="Call campaigns" hits={results.callCampaigns} icon={PhoneIcon} onPick={go} />
            <HitGroup heading="Email campaigns" hits={results.emailCampaigns} icon={MailIcon} onPick={go} />
            {pages.length > 0 || showHelpItem ? (
              <CommandGroup heading="Pages">
                {pages.map((p) => (
                  <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)}>
                    <p.icon aria-hidden />
                    {p.label}
                  </CommandItem>
                ))}
                {showHelpItem ? (
                  <CommandItem
                    value="page:shortcuts"
                    onSelect={() => {
                      closeSoon();
                      setHelpOpen(true);
                    }}
                  >
                    <KeyboardIcon aria-hidden />
                    Keyboard shortcuts
                    <span className="ml-auto text-xs text-muted-foreground">?</span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}
            {loading && q ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
                <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> Searching…
              </div>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} mod={mod} />
    </>
  );
}
