"use client";

import * as React from "react";
import Link from "next/link";
import { DownloadIcon, MailIcon, PhoneIcon, SearchIcon, SkipForwardIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type LeadStatus, leadStatusEnum } from "@/db/schema";
import { LEAD_CSV_COLUMNS, leadsCsvFilename } from "@/features/leads/csv";
import {
  type CampaignTarget,
  LEAD_TAB_FILTERS,
  type LeadRow,
  type LeadTab,
  filterLeads,
} from "@/features/leads/types";
import { downloadCsv } from "@/lib/export-csv";
import { formatPhone, formatRating } from "@/lib/format";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { AddToCampaignDialog, type CampaignKind } from "./add-to-campaign-dialog";
import { StatusBadge } from "./status-badge";

const ALL_CATEGORIES = "__all__";

export type LeadQueueTableProps = {
  leads: LeadRow[];
  campaigns: { call: CampaignTarget[]; email: CampaignTarget[] };
  onUpdateStatus: (id: string, status: LeadStatus) => void;
  onSaveNotes: (id: string, notes: string | null) => void;
  onRemove: (id: string) => void;
  onBulkRemove: (ids: string[]) => Promise<boolean>;
  /** Resolves true on success (the dialog closes and the selection clears). */
  onAddToCampaign: (kind: CampaignKind, campaignId: string, ids: string[]) => Promise<boolean>;
  /** Creates a draft call campaign from a name and resolves its id; enables "New campaign" in the dialog. */
  onCreateCallCampaign?: (name: string) => Promise<string | null>;
  /** Defaults to a browser CSV download of the visible rows. */
  onExport?: (rows: LeadRow[]) => void;
};

/**
 * Pipeline table (gtm LeadQueueTable, non-voice): status tabs, search,
 * category select, selection actions, export, inline status and notes.
 * All filtering is client-side over `leads`.
 */
export function LeadQueueTable({
  leads,
  campaigns,
  onUpdateStatus,
  onSaveNotes,
  onRemove,
  onBulkRemove,
  onAddToCampaign,
  onCreateCallCampaign,
  onExport,
}: LeadQueueTableProps) {
  const [tab, setTab] = React.useState<LeadTab>("all");
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<string>(ALL_CATEGORIES);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  // `ids` set: the dialog is for that one row; otherwise for the current selection.
  const [picking, setPicking] = React.useState<{ kind: CampaignKind; ids?: string[] } | null>(null);

  const categories = React.useMemo(
    () => [...new Set(leads.map((l) => l.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [leads],
  );
  const activeCategory = category !== ALL_CATEGORIES && categories.includes(category) ? category : null;

  const visible = React.useMemo(
    () => filterLeads(leads, { tab, search, category: activeCategory }),
    [leads, tab, search, activeCategory],
  );

  // Only ids still present count as selected (removed leads drop out).
  const selectedIds = React.useMemo(() => leads.filter((l) => selected.has(l.id)).map((l) => l.id), [leads, selected]);
  const allSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const someSelected = !allSelected && visible.some((l) => selected.has(l.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((l) => l.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkRemove() {
    if (await onBulkRemove(selectedIds)) setSelected(new Set());
  }

  function exportVisible() {
    if (onExport) onExport(visible);
    else downloadCsv(leadsCsvFilename(), LEAD_CSV_COLUMNS, visible);
  }

  const n = selectedIds.length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3" data-testid="lead-filters">
        <Tabs value={tab} onValueChange={(v) => setTab(v as LeadTab)}>
          <TabsList variant="line" aria-label="Filter by status" className="flex-wrap">
            {LEAD_TAB_FILTERS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="relative w-full sm:w-48">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search leads"
            placeholder="Search name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full pl-8 text-xs"
          />
        </div>

        {categories.length > 1 && (
          <Select value={activeCategory ?? ALL_CATEGORIES} onValueChange={setCategory}>
            <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Reserved width on wide screens prevents layout shift when the selection appears. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:min-w-[280px]" data-testid="selection-actions">
          {n > 0 ? (
            <>
              <span className="text-xs text-muted-foreground tabular-nums">{n} selected</span>
              <Button size="sm" variant="outline" onClick={() => setPicking({ kind: "call" })}>
                <PhoneIcon /> Add to call campaign…
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPicking({ kind: "email" })}>
                <MailIcon /> Add to email sequence…
              </Button>
              <Button size="sm" variant="destructive" onClick={bulkRemove}>
                <Trash2Icon /> Remove
              </Button>
            </>
          ) : (
            <span aria-hidden className="invisible hidden text-xs tabular-nums sm:inline">
              0 selected
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="lead-count">
            {visible.length} lead{visible.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" variant="outline" onClick={exportVisible} disabled={visible.length === 0}>
            <DownloadIcon /> Export CSV
          </Button>
        </div>
      </div>

      <div className="min-w-0 rounded-lg bg-surface shadow-[var(--shadow-elevated)]" data-testid="lead-table-scroll">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all visible leads"
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  disabled={visible.length === 0}
                />
              </TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>L30D</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No leads match this filter
                </TableCell>
              </TableRow>
            ) : (
              visible.map((lead) => (
                <TableRow key={lead.id} data-lead-id={lead.id} data-state={selected.has(lead.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${lead.name}`}
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggleOne(lead.id)}
                    />
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap tabular-nums">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="underline-offset-4 hover:text-primary hover:underline">
                        {formatPhone(lead.phone)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">No phone</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <p className="truncate" title={lead.name}>
                      {lead.name}
                    </p>
                    {lead.callCampaigns?.length ? (
                      <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground" data-testid="lead-campaigns">
                        <PhoneIcon className="size-3 shrink-0" aria-hidden />
                        <span className="sr-only">Queued for calls in</span>
                        {lead.callCampaigns.map((c, i) => (
                          <React.Fragment key={c.id}>
                            {i > 0 && ", "}
                            <Link href={`/calling/${c.id}`} className="truncate underline-offset-2 hover:text-primary hover:underline">
                              {c.name}
                            </Link>
                          </React.Fragment>
                        ))}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{lead.category ?? "—"}</TableCell>
                  <TableCell>
                    <StatusSelect lead={lead} onChange={(s) => onUpdateStatus(lead.id, s)} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{formatRating(lead.rating)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{lead.l30d}</TableCell>
                  <TableCell className="min-w-[200px]">
                    <NotesCell key={`${lead.id}:${lead.notes ?? ""}`} lead={lead} onSave={(v) => onSaveNotes(lead.id, v)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title={lead.phone ? "Add to call campaign" : "No phone number to call"}
                        aria-label={`Add ${lead.name} to a call campaign`}
                        disabled={!lead.phone}
                        onClick={() => setPicking({ kind: "call", ids: [lead.id] })}
                      >
                        <PhoneIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="Skip"
                        aria-label={`Skip ${lead.name}`}
                        disabled={lead.status === "skipped"}
                        onClick={() => onUpdateStatus(lead.id, "skipped")}
                      >
                        <SkipForwardIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        title="Remove"
                        aria-label={`Remove ${lead.name}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => onRemove(lead.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {picking && (
        <AddToCampaignDialog
          kind={picking.kind}
          count={picking.ids?.length ?? n}
          subject={picking.ids?.length === 1 ? leads.find((l) => l.id === picking.ids?.[0])?.name : undefined}
          campaigns={campaigns[picking.kind]}
          onClose={() => setPicking(null)}
          onCreate={picking.kind === "call" ? onCreateCallCampaign : undefined}
          onSubmit={async (campaignId) => {
            const done = await onAddToCampaign(picking.kind, campaignId, picking.ids ?? selectedIds);
            if (done && !picking.ids) setSelected(new Set());
            return done;
          }}
        />
      )}
    </div>
  );
}

function StatusSelect({ lead, onChange }: { lead: LeadRow; onChange: (s: LeadStatus) => void }) {
  return (
    <Select value={lead.status} onValueChange={(v) => v !== lead.status && onChange(v as LeadStatus)}>
      <SelectTrigger
        size="sm"
        aria-label={`Status for ${lead.name}`}
        className="h-7 border-transparent bg-transparent px-1 shadow-none dark:bg-transparent"
      >
        <SelectValue>
          <StatusBadge status={lead.status} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {leadStatusEnum.enumValues.map((s) => (
          <SelectItem key={s} value={s}>
            {LEAD_STATUS_LABELS[s].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Inline notes: saves on blur or Enter when changed; Escape reverts. Remounted when saved notes change. */
function NotesCell({ lead, onSave }: { lead: LeadRow; onSave: (notes: string | null) => void }) {
  const saved = lead.notes ?? "";
  const [value, setValue] = React.useState(saved);
  const skipNextBlur = React.useRef(false);

  function commit() {
    if (skipNextBlur.current) {
      skipNextBlur.current = false;
      return;
    }
    const next = value.trim();
    if (next === saved.trim()) return;
    onSave(next ? next : null);
  }

  return (
    <Input
      aria-label={`Notes for ${lead.name}`}
      placeholder="Add a note…"
      value={value}
      maxLength={5000}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          skipNextBlur.current = true;
          setValue(saved);
          e.currentTarget.blur();
        }
      }}
      className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
    />
  );
}
