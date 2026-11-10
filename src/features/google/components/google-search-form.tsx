"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorsFor, useFormAction } from "@/features/businesses/components/crm-form";
import type { ActionResult } from "@/lib/action-result";
// niches.ts is pure data; never import plan.ts or zips.ts here (server only, 5 MB of zip data).
import { NICHES } from "@/lib/google-places/niches";
import { type GooglePreview, previewGoogleSearchAction, startGoogleSearchAction } from "../server-actions";

/** Wait after the last edit before asking the server for the plan. */
export const PREVIEW_DEBOUNCE_MS = 400;
const CUSTOM = "__custom";
export const AREA_HELP = 'Zip codes ("75201, 75202"), a city ("Dallas, TX"), or a zip and a radius in miles ("75201 +10mi").';

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function splitTerms(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "3 terms × 12 zips = 36 searches · up to 108 requests · about $3.78 at most · 892 of 1,000 requests left this month" */
export function planLine(p: GooglePreview): string {
  const left = Math.max(0, p.cap - p.usedThisMonth);
  const { preview: v } = p;
  return [
    `${plural(v.terms.length, "term")} × ${plural(v.zipCount, "zip")} = ${plural(v.queries, "search", "searches")}`,
    `up to ${plural(v.maxRequests, "request")}`,
    `about ${usd(v.estMaxUsd)} at most`,
    `${n(left)} of ${n(p.cap)} requests left this month`,
  ].join(" · ");
}

/** Why the plan cannot start; null when it can. */
export function blockReason(p: GooglePreview): string | null {
  const left = Math.max(0, p.cap - p.usedThisMonth);
  if (left === 0)
    return `This month's cap of ${n(p.cap)} Google requests is used up. Raise GOOGLE_PLACES_MONTHLY_REQUEST_CAP or wait until next month.`;
  if (p.preview.maxRequests > left)
    return `This plan can use up to ${plural(p.preview.maxRequests, "request")}, but only ${n(left)} are left this month. Use fewer pages, terms or zips.`;
  return null;
}

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: ActionResult<GooglePreview> };

/**
 * Google Maps form on /searches/new: niche (fills the terms), editable terms,
 * area, pages per search, and a live plan line from `previewGoogleSearchAction`
 * (debounced). Start is disabled, with the reason shown, while the plan is
 * invalid, over a limit or larger than the requests left this month.
 */
export function GoogleSearchForm({ defaultNicheId = "roofing" }: { defaultNicheId?: string }) {
  const router = useRouter();
  const first = NICHES.find((x) => x.id === defaultNicheId) ?? null;
  const [nicheId, setNicheId] = React.useState<string>(first?.id ?? CUSTOM);
  const [terms, setTerms] = React.useState(first ? first.terms.join(", ") : "");
  const [area, setArea] = React.useState("");
  const [pages, setPages] = React.useState("3");
  const { state, pending, onSubmit } = useFormAction(startGoogleSearchAction);

  React.useEffect(() => {
    if (!state) return;
    if (state.ok) router.push(`/searches/${state.data.jobId}`);
    else if (!state.fieldErrors) toast.error(state.message ?? "Could not start the search.");
  }, [state, router]);

  // Debounced plan preview. Each answer is stored with the inputs it was for,
  // so an answer for older inputs never shows as the current plan.
  const input = React.useMemo(
    () => ({
      nicheId: nicheId === CUSTOM ? null : nicheId,
      terms: splitTerms(terms),
      area: area.trim(),
      maxPagesPerQuery: Number(pages) as 1 | 2 | 3,
    }),
    [nicheId, terms, area, pages],
  );
  const inputKey = JSON.stringify(input);
  const [answer, setAnswer] = React.useState<{ key: string; result: ActionResult<GooglePreview> } | null>(null);
  React.useEffect(() => {
    if (!input.area) return;
    let stale = false;
    const timer = setTimeout(() => {
      previewGoogleSearchAction(input).then(
        (result) => !stale && setAnswer({ key: inputKey, result }),
        () => !stale && setAnswer({ key: inputKey, result: { ok: false, message: "Could not work out the plan. Try again." } }),
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [input, inputKey]);
  const preview: PreviewState = !input.area
    ? { kind: "idle" }
    : answer && answer.key === inputKey
      ? { kind: "done", result: answer.result }
      : { kind: "loading" };

  function chooseNiche(id: string) {
    setNicheId(id);
    const niche = NICHES.find((x) => x.id === id);
    if (niche) setTerms(niche.terms.join(", "));
  }

  const result = preview.kind === "done" ? preview.result : null;
  const planError = result && !result.ok ? result : null;
  const plan = result && result.ok ? result.data : null;
  const blocked = plan ? blockReason(plan) : null;
  const previewFieldError = (name: string) => planError?.fieldErrors?.[name]?.[0];
  const err = (name: string) => errorsFor(state, name) ?? previewFieldError(name);
  const inv = (name: string) => (err(name) ? true : undefined);
  const navigating = pending || state?.ok === true;
  const canStart = !!plan && !blocked && preview.kind === "done" && !navigating;
  const reason =
    preview.kind === "idle"
      ? "Enter an area to see the plan and its cost."
      : preview.kind === "loading"
        ? null
        : planError
          ? (planError.message && !planError.fieldErrors ? planError.message : Object.values(planError.fieldErrors ?? {})[0]?.[0] ?? "The plan is not valid.")
          : blocked;

  return (
    <form onSubmit={onSubmit} noValidate aria-label="New Google Maps search">
      <input type="hidden" name="nicheId" value={nicheId === CUSTOM ? "" : nicheId} />
      <input type="hidden" name="maxPagesPerQuery" value={pages} />
      <FieldGroup className="gap-4">
        <Field data-invalid={inv("nicheId")}>
          <FieldLabel id="google-niche-label">Niche</FieldLabel>
          <Select value={nicheId} onValueChange={chooseNiche}>
            <SelectTrigger className="w-full" aria-labelledby="google-niche-label">
              <SelectValue placeholder="Choose a niche" />
            </SelectTrigger>
            <SelectContent>
              {NICHES.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>Custom terms (no category rule)</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Fills in the search terms and decides which Google place types count as on-target.</FieldDescription>
          {err("nicheId") ? <FieldError>{err("nicheId")}</FieldError> : null}
        </Field>
        <Field data-invalid={inv("terms")}>
          <FieldLabel htmlFor="google-terms">Search terms</FieldLabel>
          <Input
            id="google-terms"
            name="terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="roofer, roofing contractor"
            aria-invalid={inv("terms")}
            autoCapitalize="off"
          />
          <FieldDescription>Comma-separated. Each term is searched in every zip code, up to 12 terms.</FieldDescription>
          {err("terms") ? <FieldError>{err("terms")}</FieldError> : null}
        </Field>
        <Field data-invalid={inv("area")}>
          <FieldLabel htmlFor="google-area">Area</FieldLabel>
          <Input
            id="google-area"
            name="area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Dallas, TX"
            aria-invalid={inv("area")}
            autoComplete="off"
          />
          <FieldDescription>{AREA_HELP}</FieldDescription>
          {err("area") ? <FieldError>{err("area")}</FieldError> : null}
        </Field>
        <Field data-invalid={inv("maxPagesPerQuery")}>
          <FieldLabel id="google-pages-label">Pages per search</FieldLabel>
          <Select value={pages} onValueChange={setPages}>
            <SelectTrigger className="w-full sm:w-48" aria-labelledby="google-pages-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 page (up to 20 places)</SelectItem>
              <SelectItem value="2">2 pages (up to 40 places)</SelectItem>
              <SelectItem value="3">3 pages (up to 60 places)</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>Each page is one Google request. A search stops early when Google has no more results.</FieldDescription>
          {err("maxPagesPerQuery") ? <FieldError>{err("maxPagesPerQuery")}</FieldError> : null}
        </Field>

        <div className="flex flex-col gap-2 rounded-lg bg-surface-elevated px-3 py-3" aria-live="polite" data-testid="google-plan">
          <span className="text-[10px] tracking-wider text-muted-foreground uppercase">Plan and cost</span>
          {preview.kind === "loading" ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Working out the plan…
            </span>
          ) : plan ? (
            <span className="text-sm tabular-nums" data-testid="google-plan-line">
              {planLine(plan)}
            </span>
          ) : null}
          {plan ? (
            <span className="text-xs text-muted-foreground">
              {plan.preview.areaLabel}. Cost is an estimate at the maximum; most searches use fewer pages.
            </span>
          ) : null}
          {reason ? (
            <span
              className={`flex items-start gap-2 text-sm ${preview.kind === "idle" ? "text-muted-foreground" : "text-destructive"}`}
              data-testid="google-plan-reason"
            >
              {preview.kind === "idle" ? null : <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />}
              {reason}
            </span>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={!canStart}>
            {navigating ? "Starting…" : "Start Google search"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
