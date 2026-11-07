"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon, PlusCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, type NumberFormat } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { KbdGroup } from "./kbd";

export type ActiveFilter = {
  /** Stable key, e.g. `"status:new"`. */
  id: string;
  /** Pill text, e.g. "Status: New". Also used in the remove button's accessible name. */
  label: string;
  /** Removes this filter (the pill's × button). */
  onRemove: () => void;
};

export type FilterBarSearch = {
  /** Current query (controlled; typically from the URL). */
  value: string;
  /** Called with the new query after `debounceMs` of no typing (immediately on clear/Enter). */
  onChange: (value: string) => void;
  /** Placeholder. Default "Search…". */
  placeholder?: string;
  /** Debounce in ms. Default 250. Use 0 for every keystroke. */
  debounceMs?: number;
  /** Accessible name. Default "Search". */
  "aria-label"?: string;
};

export type FilterBarProps = {
  /** Search box on the left; focus it with ⌘/ (Ctrl+/ on Windows/Linux). Omit for no search. */
  search?: FilterBarSearch;
  /** Filter chips: `FilterSelect`, `FilterRange`, or custom buttons. */
  children?: React.ReactNode;
  /** Pills for the filters currently applied, each removable. */
  activeFilters?: ActiveFilter[];
  /** Shows "Clear all" after the pills when set and at least one filter is active. */
  onClearAll?: () => void;
  /** Right-aligned slot (view toggles, export, primary action). */
  actions?: React.ReactNode;
  className?: string;
};

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function SearchBox({ search }: { search: FilterBarSearch }) {
  const { value, onChange, placeholder = "Search…", debounceMs = 250 } = search;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState(value);
  const [synced, setSynced] = React.useState(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mac, setMac] = React.useState(true);

  // Adopt external changes (back button, "Clear all") without fighting the user's typing.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  React.useEffect(() => {
    // Platform is only known on the client; render ⌘ on the server and correct after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMac(isMac());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const emit = (next: string, immediate = false) => {
    if (timer.current) clearTimeout(timer.current);
    if (immediate || debounceMs <= 0) {
      setSynced(next);
      onChange(next);
      return;
    }
    timer.current = setTimeout(() => {
      setSynced(next);
      onChange(next);
    }, debounceMs);
  };

  return (
    <div className="relative w-full min-w-0 sm:w-64">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        type="search"
        value={draft}
        placeholder={placeholder}
        aria-label={search["aria-label"] ?? "Search"}
        aria-keyshortcuts={mac ? "Meta+/" : "Control+/"}
        onChange={(e) => {
          setDraft(e.target.value);
          emit(e.target.value, e.target.value === "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") emit(draft, true);
          if (e.key === "Escape") {
            if (draft) {
              e.preventDefault();
              setDraft("");
              emit("", true);
            } else {
              inputRef.current?.blur();
            }
          }
        }}
        className="peer h-7 pr-12 pl-7 text-dense [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft("");
            emit("", true);
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      ) : (
        <KbdGroup
          keys={[mac ? "⌘" : "Ctrl", "/"]}
          className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 peer-focus:hidden"
        />
      )}
    </div>
  );
}

/**
 * Filter row above a table: search (⌘/ focuses it), filter chips, active
 * filter pills with remove and "Clear all", and a right-side slot. Fully
 * controlled: the page owns filter state (usually URL search params).
 */
export function FilterBar({ search, children, activeFilters = [], onClearAll, actions, className }: FilterBarProps) {
  return (
    <div data-slot="filter-bar" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {search ? <SearchBox search={search} /> : null}
        {children ? <div className="flex flex-wrap items-center gap-1.5">{children}</div> : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {activeFilters.length > 0 ? (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => (
            <li
              key={f.id}
              data-slot="filter-pill"
              className="inline-flex h-6 items-center gap-1 rounded-sm border bg-secondary pr-0.5 pl-2 text-xs text-secondary-foreground"
            >
              <span className="max-w-60 truncate">{f.label}</span>
              <button
                type="button"
                aria-label={`Remove filter ${f.label}`}
                onClick={f.onRemove}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </li>
          ))}
          {onClearAll ? (
            <li>
              <Button variant="ghost" size="xs" onClick={onClearAll} className="text-muted-foreground">
                Clear all
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function ChipTrigger({
  label,
  summary,
  active,
  ...props
}: React.ComponentProps<"button"> & { label: string; summary?: string; active: boolean }) {
  return (
    <button
      type="button"
      data-slot="filter-chip"
      data-active={active || undefined}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-dense whitespace-nowrap transition-colors",
        "hover:bg-muted aria-expanded:bg-muted",
        active ? "border-primary/40 bg-primary/5 text-foreground" : "border-dashed text-muted-foreground",
      )}
      {...props}
    >
      {active ? null : <PlusCircleIcon className="size-3.5" aria-hidden />}
      <span className={cn(active && "text-muted-foreground")}>{label}</span>
      {summary ? <span className="max-w-40 truncate font-medium">{summary}</span> : null}
      <ChevronDownIcon className="size-3.5 opacity-60" aria-hidden />
    </button>
  );
}

export type FilterOption = {
  /** Value stored in the filter state / URL. */
  value: string;
  /** Visible label. */
  label: string;
  /** Optional count shown right-aligned (e.g. matching rows). */
  count?: number;
  /** Optional leading element (e.g. a `StatusBadge variant="dot"`-style dot). */
  icon?: React.ReactNode;
};

export type FilterSelectProps = {
  /** Chip label, e.g. "Status". */
  label: string;
  /** Choices. */
  options: FilterOption[];
  /** Selected values. */
  value: string[];
  /** Called with the next selected values. */
  onChange: (value: string[]) => void;
  /** Allow several values. Default true; when false, picking an option replaces the selection and closes the popover. */
  multiple?: boolean;
  /** Show a type-to-filter box in the popover. Default: when there are more than 7 options. */
  searchable?: boolean;
};

/** Filter chip opening a list of options (checkbox list, keyboard navigable). */
export function FilterSelect({ label, options, value, onChange, multiple = true, searchable }: FilterSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = new Set(value);
  const picked = options.filter((o) => selected.has(o.value));
  const summary = picked.length === 0 ? undefined : picked.length <= 2 ? picked.map((o) => o.label).join(", ") : `${picked.length} selected`;
  const showSearch = searchable ?? options.length > 7;

  const toggle = (v: string) => {
    if (!multiple) {
      onChange(selected.has(v) ? [] : [v]);
      setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(options.map((o) => o.value).filter((x) => next.has(x)));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipTrigger label={label} summary={summary} active={picked.length > 0} aria-label={`Filter by ${label}`} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          {showSearch ? <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} className="h-8 text-dense" /> : null}
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isSel = selected.has(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={o.label}
                    onSelect={() => toggle(o.value)}
                    aria-selected={isSel}
                    className="text-dense"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                        isSel ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {isSel ? <CheckIcon className="size-3" /> : null}
                    </span>
                    {o.icon}
                    <span className="truncate">{o.label}</span>
                    {o.count !== undefined ? (
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatNumber(o.count)}</span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {picked.length > 0 ? (
            <div className="border-t p-1">
              <Button variant="ghost" size="xs" className="w-full justify-center" onClick={() => onChange([])}>
                Clear
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** `[min, max]`; `null` means unbounded on that side. */
export type RangeValue = [number | null, number | null];

export type FilterRangeProps = {
  /** Chip label, e.g. "Rating". */
  label: string;
  /** Lowest selectable value (slider start). */
  min: number;
  /** Highest selectable value (slider end). */
  max: number;
  /** Slider/input step. Default 1. */
  step?: number;
  /** Applied range; `[null, null]` = no filter. */
  value: RangeValue;
  /** Called with the applied range when the user presses Apply/Enter (or `[null, null]` on Clear). */
  onChange: (value: RangeValue) => void;
  /** Format for the chip summary. Default `integer`; use `decimal` for ratings. */
  format?: NumberFormat;
};

function rangeSummary([lo, hi]: RangeValue, fmt: (n: number) => string): string | undefined {
  if (lo === null && hi === null) return undefined;
  if (lo !== null && hi !== null) return `${fmt(lo)}–${fmt(hi)}`;
  if (lo !== null) return `≥ ${fmt(lo)}`;
  return `≤ ${fmt(hi as number)}`;
}

/** Filter chip opening a two-thumb slider with min/max inputs. Values apply on "Apply" or Enter. */
export function FilterRange({ label, min, max, step = 1, value, onChange, format = "integer" }: FilterRangeProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<[number, number]>([value[0] ?? min, value[1] ?? max]);
  const fmt = (n: number) => formatNumber(n, format);
  const summary = rangeSummary(value, fmt);

  const apply = () => {
    const lo = Math.max(min, Math.min(draft[0], draft[1]));
    const hi = Math.min(max, Math.max(draft[0], draft[1]));
    onChange([lo <= min ? null : lo, hi >= max ? null : hi]);
    setOpen(false);
  };

  const num = (s: string, fallback: number) => {
    const n = Number(s);
    return s.trim() === "" || !Number.isFinite(n) ? fallback : n;
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft([value[0] ?? min, value[1] ?? max]);
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <ChipTrigger label={label} summary={summary} active={summary !== undefined} aria-label={`Filter by ${label}`} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <span className="text-xs font-medium">{label}</span>
          <Slider
            min={min}
            max={max}
            step={step}
            value={draft}
            onValueChange={(v) => setDraft([v[0], v[1]])}
            aria-label={`${label} range`}
          />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              aria-label={`Minimum ${label}`}
              className="h-7 text-dense"
              min={min}
              max={max}
              step={step}
              value={draft[0]}
              onChange={(e) => setDraft([num(e.target.value, min), draft[1]])}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              inputMode="decimal"
              aria-label={`Maximum ${label}`}
              className="h-7 text-dense"
              min={min}
              max={max}
              step={step}
              value={draft[1]}
              onChange={(e) => setDraft([draft[0], num(e.target.value, max)])}
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange([null, null]);
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button type="submit" size="sm">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
