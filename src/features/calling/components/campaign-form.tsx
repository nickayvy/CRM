"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { CallCampaign } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import { shortTime } from "../time";
import { SCRIPT_TOKENS } from "../script-tokens";

type Values = Pick<
  CallCampaign,
  | "name"
  | "description"
  | "script"
  | "dailyCap"
  | "callingHoursStart"
  | "callingHoursEnd"
  | "timezone"
  | "maxConcurrentAgents"
  | "maxAttempts"
  | "autoResume"
>;

export type CampaignFormProps = {
  action: (prev: ActionResult<{ id: string }> | null, formData: FormData) => Promise<ActionResult<{ id: string }>>;
  initial?: Partial<Values>;
  submitLabel: string;
  cancelHref: string;
  /** Show a toast on a successful (non-redirecting) save. */
  successMessage?: string;
};

// A fixed list (not Intl.supportedValuesOf) so server and browser render identical options.
const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

function allZones(current: string): string[] {
  return current && !ZONES.includes(current) ? [current, ...ZONES] : ZONES;
}

const selectClass =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

export function CampaignForm({ action, initial = {}, submitLabel, cancelHref, successMessage }: CampaignFormProps) {
  const [state, formAction, pending] = React.useActionState(action, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const err = (k: string) => (errors[k]?.length ? errors[k].map((message) => ({ message })) : undefined);
  const timezone = initial.timezone ?? "America/Chicago";
  const zones = React.useMemo(() => allZones(timezone), [timezone]);
  const scriptRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!state) return;
    if (state.ok && successMessage) toast.success(successMessage);
    if (!state.ok && state.message) toast.error(state.message);
  }, [state, successMessage]);

  function insertToken(token: string) {
    const el = scriptRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const text = `{{${token}}}`;
    el.setRangeText(text, start, end, "end");
    el.focus();
  }

  return (
    <form
      action={formAction}
      // Dispatch manually so React does not reset the fields when validation fails.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        React.startTransition(() => formAction(fd));
      }}
      className="grid gap-8 rounded-lg bg-surface p-4 shadow-[var(--shadow-elevated)] sm:p-6"
      noValidate
    >
      <FieldSet>
        <FieldLegend>Campaign</FieldLegend>
        <FieldGroup>
          <Field data-invalid={!!err("name") || undefined}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" defaultValue={initial.name ?? ""} required aria-invalid={!!err("name") || undefined} />
            <FieldError errors={err("name")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Input id="description" name="description" defaultValue={initial.description ?? ""} />
            <FieldError errors={err("description")} />
          </Field>
          <Field data-invalid={!!err("script") || undefined}>
            <FieldLabel htmlFor="script">Script</FieldLabel>
            <Textarea
              id="script"
              name="script"
              ref={scriptRef}
              rows={9}
              defaultValue={initial.script ?? ""}
              className="font-mono text-sm"
              placeholder={"Hi, is this {{owner_first_name}}? I'm calling about {{business_name}} in {{city}}…"}
            />
            <FieldDescription>
              Markdown. Tokens are filled from the business in the dialer; click one to insert it:
            </FieldDescription>
            <div className="flex flex-wrap gap-1.5" aria-label="Script tokens">
              {SCRIPT_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => insertToken(t.token)}
                  title={t.description}
                  className="rounded-md bg-muted/30 px-1.5 py-0.5 font-mono text-xs transition-colors duration-300 ease-out hover:bg-muted"
                >
                  {`{{${t.token}}}`}
                </button>
              ))}
            </div>
            <FieldError errors={err("script")} />
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Pacing</FieldLegend>
        <FieldGroup className="grid gap-6 sm:grid-cols-2">
          <Field data-invalid={!!err("dailyCap") || undefined}>
            <FieldLabel htmlFor="dailyCap">Daily cap</FieldLabel>
            <Input
              id="dailyCap"
              name="dailyCap"
              type="number"
              min={1}
              inputMode="numeric"
              defaultValue={initial.dailyCap ?? ""}
              placeholder="No cap"
              aria-invalid={!!err("dailyCap") || undefined}
            />
            <FieldDescription>Calls with an outcome per local day. Empty = no cap.</FieldDescription>
            <FieldError errors={err("dailyCap")} />
          </Field>
          <Field data-invalid={!!err("timezone") || undefined}>
            <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
            <select id="timezone" name="timezone" defaultValue={timezone} className={selectClass} aria-invalid={!!err("timezone") || undefined}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <FieldError errors={err("timezone")} />
          </Field>
          <Field data-invalid={!!err("callingHoursStart") || undefined}>
            <FieldLabel htmlFor="callingHoursStart">Calling hours start</FieldLabel>
            <Input
              id="callingHoursStart"
              name="callingHoursStart"
              type="time"
              defaultValue={shortTime(initial.callingHoursStart)}
              aria-invalid={!!err("callingHoursStart") || undefined}
            />
            <FieldError errors={err("callingHoursStart")} />
          </Field>
          <Field data-invalid={!!err("callingHoursEnd") || undefined}>
            <FieldLabel htmlFor="callingHoursEnd">Calling hours end</FieldLabel>
            <Input
              id="callingHoursEnd"
              name="callingHoursEnd"
              type="time"
              defaultValue={shortTime(initial.callingHoursEnd)}
              aria-invalid={!!err("callingHoursEnd") || undefined}
            />
            <FieldDescription>Leave both empty to call any time. End is exclusive.</FieldDescription>
            <FieldError errors={err("callingHoursEnd")} />
          </Field>
          <Field data-invalid={!!err("maxConcurrentAgents") || undefined}>
            <FieldLabel htmlFor="maxConcurrentAgents">Max concurrent agents</FieldLabel>
            <Input
              id="maxConcurrentAgents"
              name="maxConcurrentAgents"
              type="number"
              min={1}
              max={50}
              defaultValue={initial.maxConcurrentAgents ?? 5}
              aria-invalid={!!err("maxConcurrentAgents") || undefined}
            />
            <FieldDescription>1–50</FieldDescription>
            <FieldError errors={err("maxConcurrentAgents")} />
          </Field>
          <Field data-invalid={!!err("maxAttempts") || undefined}>
            <FieldLabel htmlFor="maxAttempts">Max attempts per business</FieldLabel>
            <Input
              id="maxAttempts"
              name="maxAttempts"
              type="number"
              min={1}
              max={10}
              defaultValue={initial.maxAttempts ?? 3}
              aria-invalid={!!err("maxAttempts") || undefined}
            />
            <FieldDescription>No answer, voicemail and busy retry until this many attempts (1–10).</FieldDescription>
            <FieldError errors={err("maxAttempts")} />
          </Field>
          <Field orientation="horizontal" className="sm:col-span-2">
            <Switch id="autoResume" name="autoResume" defaultChecked={initial.autoResume ?? true} />
            <FieldLabel htmlFor="autoResume" className="font-normal">
              Resume automatically when the daily cap resets, calling hours open, or callbacks come due
            </FieldLabel>
          </Field>
        </FieldGroup>
      </FieldSet>

      {state && !state.ok && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
