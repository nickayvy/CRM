"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { FilterSelect, SidePanel } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Qualification } from "@/db/schema";
import { QUALIFICATION_LABELS } from "@/lib/labels";
import { type AddOptions, addBusinessesAction, loadAddOptionsAction, previewAddAction } from "../actions";
import type { AddFilter } from "../schema";

export type AddBusinessesPanelProps = {
  campaignId: string;
  /** Preloaded choices; otherwise they load when the panel first opens. */
  options?: AddOptions;
  /** Render the trigger as the primary button (a draft with an empty queue). */
  primary?: boolean;
};

const SOURCE_BTN =
  "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors duration-200 aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground text-muted-foreground hover:text-foreground";

const selectClass =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

type Preview = { matching: number; addable: number } | "error" | null;

/** "Add businesses" button + side panel: filter, live count, "Add N". */
export function AddBusinessesPanel({ campaignId, options: preloaded, primary = false }: AddBusinessesPanelProps) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<AddOptions | null>(preloaded ?? null);
  // null until the user (or the first load) picks: leads when they have any, else every business.
  const [source, setSource] = React.useState<"leads" | "all" | null>(null);
  const [qualification, setQualification] = React.useState<string[]>(["qualified"]);
  const [hasPhone, setHasPhone] = React.useState(true);
  const [excludeDoNotCall, setExcludeDoNotCall] = React.useState(true);
  const [city, setCity] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [minScore, setMinScore] = React.useState("");
  const [q, setQ] = React.useState("");
  const [result, setResult] = React.useState<{ key: string; preview: Preview } | null>(null);
  const [adding, startAdding] = React.useTransition();

  const leadCount = options?.leadCount ?? 0;
  const fromLeads = (source ?? (leadCount > 0 ? "leads" : "all")) === "leads";
  const cities = options?.cities ?? [];
  const categories = options?.categories ?? [];

  React.useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    loadAddOptionsAction().then(
      (r) => {
        if (cancelled || !r.ok) return;
        setOptions(r.data);
        // Leads were hand-picked, so they are not held to the qualification rules by default.
        if (r.data.leadCount > 0) setQualification([]);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [open, options]);

  function pickSource(next: "leads" | "all") {
    setSource(next);
    setQualification(next === "leads" ? [] : ["qualified"]);
  }

  const filter = React.useMemo<AddFilter>(() => {
    const score = Number(minScore);
    return {
      ...(fromLeads ? { onlyMyLeads: true } : {}),
      qualification: qualification as Qualification[],
      hasPhone,
      excludeDoNotCall,
      ...(city ? { city } : {}),
      ...(category ? { category } : {}),
      ...(minScore !== "" && Number.isInteger(score) && score >= 0 && score <= 100 ? { minScore: score } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
    };
  }, [fromLeads, qualification, hasPhone, excludeDoNotCall, city, category, minScore, q]);

  // Live count, debounced; stale responses are dropped.
  const filterKey = JSON.stringify(filter);
  const ready = open && options !== null;
  const counting = open && result?.key !== filterKey;
  const preview = result?.key === filterKey ? result.preview : null;
  React.useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const r = await previewAddAction(campaignId, filter).catch(() => null);
      if (cancelled) return;
      setResult({ key: JSON.stringify(filter), preview: r?.ok ? r.data : "error" });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ready, campaignId, filter]);

  function add() {
    startAdding(async () => {
      const r = await addBusinessesAction(campaignId, { filter });
      if (!r.ok) {
        toast.error(r.message ?? "Could not add businesses.");
        return;
      }
      toast.success(
        `Added ${r.data.added} business${r.data.added === 1 ? "" : "es"}` +
          (r.data.skipped ? ` (${r.data.skipped} already queued or not callable)` : ""),
      );
      setOpen(false);
      setResult(null);
    });
  }

  const counts = preview && preview !== "error" ? preview : null;
  const addable = counts?.addable ?? 0;
  // Why nothing can be added, with the way out.
  const emptyHint = !counts
    ? null
    : counts.matching === 0
      ? fromLeads && leadCount === 0
        ? "You have no leads yet. Add some on Lookup, or switch to All businesses."
        : `No ${fromLeads ? "leads" : "businesses"} match. Loosen a filter: clear Qualification, or untick “Has a phone number”.`
      : counts.addable === 0
        ? `All ${counts.matching} are already in this queue, marked do not call, or have no phone.`
        : null;

  return (
    <>
      <Button size="sm" variant={primary ? "default" : "outline"} onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden /> Add businesses
      </Button>
      <SidePanel
        open={open}
        onOpenChange={setOpen}
        title="Add businesses"
        description="Queue your leads, or any business that matches the filters. Already-queued and do-not-call businesses, and those without a phone, are skipped."
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite" data-testid="add-preview">
              {preview === "error"
                ? "Could not count matches. Change a filter to try again."
                : counts === null
                  ? counting
                    ? "Counting…"
                    : ""
                  : (emptyHint ?? `${counts.matching} match · ${counts.addable} not in the queue yet`)}
            </p>
            <Button onClick={add} disabled={adding || counting || addable === 0}>
              {adding ? "Adding…" : `Add ${addable}`}
            </Button>
          </div>
        }
      >
        <FieldGroup>
          <Field>
            <FieldLabel>From</FieldLabel>
            <div role="group" aria-label="Source" className="flex gap-1 rounded-lg border border-input p-1">
              <button type="button" aria-pressed={fromLeads} className={SOURCE_BTN} onClick={() => pickSource("leads")}>
                My leads{options ? ` (${leadCount})` : ""}
              </button>
              <button type="button" aria-pressed={!fromLeads} className={SOURCE_BTN} onClick={() => pickSource("all")}>
                All businesses
              </button>
            </div>
          </Field>
          <Field>
            <FieldLabel>Qualification</FieldLabel>
            <div>
              <FilterSelect
                label="Qualification"
                options={(Object.keys(QUALIFICATION_LABELS) as Qualification[]).map((v) => ({
                  value: v,
                  label: QUALIFICATION_LABELS[v].label,
                }))}
                value={qualification}
                onChange={setQualification}
              />
            </div>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="add-hasPhone" checked={hasPhone} onCheckedChange={(v) => setHasPhone(v === true)} />
            <FieldLabel htmlFor="add-hasPhone" className="font-normal">
              Has a phone number
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="add-excludeDnc"
              checked={excludeDoNotCall}
              onCheckedChange={(v) => setExcludeDoNotCall(v === true)}
            />
            <FieldLabel htmlFor="add-excludeDnc" className="font-normal">
              Exclude do-not-call
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="add-city">City</FieldLabel>
            <select id="add-city" value={city} onChange={(e) => setCity(e.target.value)} className={selectClass}>
              <option value="">Any city</option>
              {cities.map((c) => (
                <option key={`${c.city}|${c.state}`} value={c.city}>
                  {c.city}
                  {c.state ? `, ${c.state}` : ""} ({c.count})
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="add-category">Category</FieldLabel>
            <select id="add-category" value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.alias} value={c.alias}>
                  {c.alias} ({c.count})
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="add-minScore">Minimum score</FieldLabel>
            <Input
              id="add-minScore"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-q">Name or phone contains</FieldLabel>
            <Input id="add-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. plumbing" />
            <FieldDescription>Businesses are appended to the end of the queue, best score first.</FieldDescription>
          </Field>
        </FieldGroup>
      </SidePanel>
    </>
  );
}
