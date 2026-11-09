"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PauseIcon, PlayIcon, SendIcon, SettingsIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { SidePanel, useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CampaignStatus } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import { countEnrollableAction, enrollAction, pauseAction, processNowAction, resumeAction, startAction } from "../actions";
import type { EnrollFilter } from "../schema";

type Option = { value: string; label: string };

const ANY = "__any";

function sentSummary(r: { sent: number; skipped: number; failed: number }, dryRun: boolean) {
  const parts = [`${r.sent} ${dryRun ? "recorded (dry run)" : "sent"}`];
  if (r.skipped) parts.push(`${r.skipped} skipped`);
  if (r.failed) parts.push(`${r.failed} failed`);
  return parts.join(", ");
}

export function CampaignControls({
  campaignId,
  status,
  stepCount,
  dryRun,
  cities,
  categories,
}: {
  campaignId: string;
  status: CampaignStatus;
  stepCount: number;
  dryRun: boolean;
  cities: Option[];
  categories: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [panelOpen, setPanelOpen] = React.useState(false);
  const { confirm, dialog } = useConfirm();

  function run<T>(fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk(res.data);
        router.refresh();
      } else toast.error(res.message ?? "Something went wrong");
    });
  }

  async function start() {
    const ok = await confirm({
      title: "Start this campaign?",
      description: dryRun
        ? "Step 1 is processed now for every enrolled business. No RESEND_API_KEY is set, so messages are recorded as dry runs."
        : "Step 1 is sent now to every enrolled business, within the daily cap.",
      confirmLabel: "Start",
    });
    if (ok) run(() => startAction(campaignId), (r) => toast.success(`Started: ${sentSummary(r, dryRun)}`));
  }

  return (
    <>
      {status === "draft" ? (
        <Button onClick={start} disabled={pending || stepCount === 0}>
          <PlayIcon data-icon="inline-start" />
          Start
        </Button>
      ) : null}
      {status === "running" ? (
        <Button variant="outline" onClick={() => run(() => pauseAction(campaignId), () => toast.success("Campaign paused"))} disabled={pending}>
          <PauseIcon data-icon="inline-start" />
          Pause
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button onClick={() => run(() => resumeAction(campaignId), () => toast.success("Campaign resumed"))} disabled={pending}>
          <PlayIcon data-icon="inline-start" />
          Resume
        </Button>
      ) : null}
      {status === "running" ? (
        <Button
          variant="outline"
          onClick={() => run(() => processNowAction(campaignId), (r) => toast.success(`Processed: ${sentSummary(r, dryRun)}`))}
          disabled={pending}
        >
          <SendIcon data-icon="inline-start" />
          Process now
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => setPanelOpen(true)}>
        <UserPlusIcon data-icon="inline-start" />
        Enroll businesses
      </Button>
      <Button variant="ghost" size="icon" asChild>
        <Link href={`/email/${campaignId}/settings`} aria-label="Campaign settings">
          <SettingsIcon />
        </Link>
      </Button>
      {dialog}
      <EnrollPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        campaignId={campaignId}
        cities={cities}
        categories={categories}
        onEnrolled={() => router.refresh()}
      />
    </>
  );
}

function EnrollPanel({
  open,
  onOpenChange,
  campaignId,
  cities,
  categories,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  cities: Option[];
  categories: Option[];
  onEnrolled: () => void;
}) {
  const [qualifiedOnly, setQualifiedOnly] = React.useState(true);
  const [hasEmail, setHasEmail] = React.useState(true);
  const [excludeDoNotEmail, setExcludeDoNotEmail] = React.useState(true);
  const [city, setCity] = React.useState(ANY);
  const [category, setCategory] = React.useState(ANY);
  const [count, setCount] = React.useState<number | null>(null);
  const [counting, setCounting] = React.useState(false);
  const [enrolling, startEnroll] = React.useTransition();

  const filter: EnrollFilter = React.useMemo(
    () => ({
      qualifiedOnly,
      hasEmail,
      excludeDoNotEmail,
      city: city === ANY ? undefined : city,
      category: category === ANY ? undefined : category,
    }),
    [qualifiedOnly, hasEmail, excludeDoNotEmail, city, category],
  );

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCounting(true);
    const t = setTimeout(async () => {
      const res = await countEnrollableAction(campaignId, filter);
      if (cancelled) return;
      setCounting(false);
      setCount(res.ok ? res.data.count : null);
      if (!res.ok) toast.error(res.message ?? "Could not count businesses");
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, campaignId, filter]);

  function enroll() {
    startEnroll(async () => {
      const res = await enrollAction(campaignId, filter);
      if (!res.ok) {
        toast.error(res.message ?? "Could not enroll");
        return;
      }
      const { enrolled, skipped } = res.data;
      toast.success(`Enrolled ${enrolled} ${enrolled === 1 ? "business" : "businesses"}${skipped ? `, ${skipped} skipped` : ""}`);
      onEnrolled();
      onOpenChange(false);
    });
  }

  const n = count ?? 0;
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title="Enroll businesses"
      description="Pick who receives this sequence. Already-enrolled businesses are not counted."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enrolling}>
            Cancel
          </Button>
          <Button onClick={enroll} disabled={enrolling || counting || n === 0}>
            {enrolling ? "Enrolling…" : `Enroll ${n}`}
          </Button>
        </>
      }
    >
      <FieldGroup className="gap-4">
        <SwitchField id="f-qualified" label="Qualified only" description="Leads that passed the qualification rules" checked={qualifiedOnly} onChange={setQualifiedOnly} />
        <SwitchField id="f-email" label="Has email" description="An owner email is on file" checked={hasEmail} onChange={setHasEmail} />
        <SwitchField id="f-dne" label="Exclude do not email" description="Skip businesses that opted out" checked={excludeDoNotEmail} onChange={setExcludeDoNotEmail} />
        <Field>
          <FieldLabel htmlFor="f-city">City</FieldLabel>
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger id="f-city" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any city</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-category">Category</FieldLabel>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="f-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any category</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="rounded-lg bg-surface-elevated p-3 text-sm shadow-[var(--shadow-inset)]" aria-live="polite" data-testid="enroll-count">
          {counting || count === null ? (
            <span className="text-muted-foreground">Counting…</span>
          ) : (
            <>
              <span className="font-serif text-2xl tracking-tight tabular-nums">{count}</span>{" "}
              <span className="text-muted-foreground">{count === 1 ? "business matches" : "businesses match"}</span>
            </>
          )}
          {!hasEmail || !excludeDoNotEmail ? (
            <p className="mt-1 text-xs text-muted-foreground">Businesses without an email or marked do not email are skipped when enrolling.</p>
          ) : null}
        </div>
      </FieldGroup>
    </SidePanel>
  );
}

function SwitchField({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}
