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
import { addBusinessesAction, previewAddAction } from "../actions";
import type { AddFilter } from "../schema";

export type AddBusinessesPanelProps = {
  campaignId: string;
  cities: { city: string; state: string; count: number }[];
  categories: { alias: string; count: number }[];
};

const selectClass =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

type Preview = { matching: number; addable: number } | null;

/** "Add businesses" button + side panel: filter, live count, "Add N". */
export function AddBusinessesPanel({ campaignId, cities, categories }: AddBusinessesPanelProps) {
  const [open, setOpen] = React.useState(false);
  const [qualification, setQualification] = React.useState<string[]>(["qualified"]);
  const [hasPhone, setHasPhone] = React.useState(true);
  const [excludeDoNotCall, setExcludeDoNotCall] = React.useState(true);
  const [city, setCity] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [minScore, setMinScore] = React.useState("");
  const [q, setQ] = React.useState("");
  const [result, setResult] = React.useState<{ key: string; preview: Preview } | null>(null);
  const [adding, startAdding] = React.useTransition();

  const filter = React.useMemo<AddFilter>(() => {
    const score = Number(minScore);
    return {
      qualification: qualification as Qualification[],
      hasPhone,
      excludeDoNotCall,
      ...(city ? { city } : {}),
      ...(category ? { category } : {}),
      ...(minScore !== "" && Number.isInteger(score) && score >= 0 && score <= 100 ? { minScore: score } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
    };
  }, [qualification, hasPhone, excludeDoNotCall, city, category, minScore, q]);

  // Live count, debounced; stale responses are dropped.
  const filterKey = JSON.stringify(filter);
  const counting = open && result?.key !== filterKey;
  const preview = result?.key === filterKey ? result.preview : null;
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const r = await previewAddAction(campaignId, filter);
      if (cancelled) return;
      setResult({ key: JSON.stringify(filter), preview: r.ok ? r.data : null });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, campaignId, filter]);

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

  const addable = preview?.addable ?? 0;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden /> Add businesses
      </Button>
      <SidePanel
        open={open}
        onOpenChange={setOpen}
        title="Add businesses"
        description="Pick businesses by filter. Already-queued and do-not-call businesses, and those without a phone, are skipped."
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="add-preview">
              {preview === null
                ? counting
                  ? "Counting…"
                  : ""
                : `${preview.matching} match · ${preview.addable} new`}
            </p>
            <Button onClick={add} disabled={adding || counting || addable === 0}>
              {adding ? "Adding…" : `Add ${addable}`}
            </Button>
          </div>
        }
      >
        <FieldGroup>
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
