"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { PageSection } from "@/components/primitives";
import { AnimatedItem, AnimatedList } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATE_TOKENS, type TemplateBusiness, renderTemplate } from "@/lib/email/template";
import { createCampaignAction, updateCampaignAction } from "../actions";

export type PreviewBusiness = TemplateBusiness & { id: string };

export type CampaignFormValues = {
  name: string;
  fromName: string;
  fromEmail: string;
  dailyCap: number;
  steps: { subject: string; body: string; delayDays: number }[];
};

type StepDraft = { key: number; subject: string; body: string; delayDays: string };
type FieldKey = "subject" | "body";

// Keys are deterministic (index-based at first render) so server and client markup match.
const toDraft = (s: CampaignFormValues["steps"][number], key: number): StepDraft => ({
  key,
  subject: s.subject,
  body: s.body,
  delayDays: String(s.delayDays),
});

function errs(fieldErrors: Record<string, string[]>, key: string) {
  return fieldErrors[key]?.map((message) => ({ message }));
}

export function CampaignForm({
  campaignId,
  initial,
  previewBusinesses,
}: {
  /** Set when editing an existing campaign. */
  campaignId?: string;
  initial: CampaignFormValues;
  previewBusinesses: PreviewBusiness[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(initial.name);
  const [fromName, setFromName] = React.useState(initial.fromName);
  const [fromEmail, setFromEmail] = React.useState(initial.fromEmail);
  const [dailyCap, setDailyCap] = React.useState(String(initial.dailyCap));
  const [steps, setSteps] = React.useState<StepDraft[]>(() => initial.steps.map((s, i) => toDraft(s, i + 1)));
  const nextKey = React.useRef(initial.steps.length + 1);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [previewId, setPreviewId] = React.useState(previewBusinesses[0]?.id ?? "");
  const preview = previewBusinesses.find((b) => b.id === previewId) ?? null;

  // Last focused subject/body field, so token chips insert at its caret.
  const lastFocus = React.useRef<{ key: number; field: FieldKey; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const updateStep = (key: number, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const move = (index: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const addStep = () =>
    setSteps((prev) => [...prev, toDraft({ subject: "", body: "", delayDays: prev.length === 0 ? 0 : 3 }, nextKey.current++)]);

  const removeStep = (key: number) => setSteps((prev) => prev.filter((s) => s.key !== key));

  function insertToken(token: string) {
    const target = lastFocus.current;
    const text = `{{${token}}}`;
    if (!target || !steps.some((s) => s.key === target.key)) {
      navigator.clipboard?.writeText(text).then(
        () => toast.message(`Copied ${text}`, { description: "Click into a subject or body first to insert it directly." }),
        () => undefined,
      );
      return;
    }
    const { el, key, field } = target;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const value = el.value.slice(0, start) + text + el.value.slice(end);
    updateStep(key, { [field]: value });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      name,
      fromName,
      fromEmail,
      dailyCap,
      steps: steps.map((s, i) => ({ subject: s.subject, body: s.body, delayDays: i === 0 ? 0 : s.delayDays })),
    };
    startTransition(async () => {
      const res = campaignId ? await updateCampaignAction(campaignId, input) : await createCampaignAction(input);
      if (res.ok) {
        setFieldErrors({});
        setFormError(null);
        toast.success(campaignId ? "Campaign saved" : "Campaign created");
        router.push(`/email/${res.data.id}`);
        router.refresh();
      } else {
        setFieldErrors(res.fieldErrors ?? {});
        setFormError(res.message ?? "Could not save the campaign.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-8" noValidate>
      <PageSection title="Campaign">
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!fieldErrors.name || undefined} className="sm:col-span-2">
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Houston plumbers intro" aria-invalid={!!fieldErrors.name || undefined} />
            <FieldError errors={errs(fieldErrors, "name")} />
          </Field>
          <Field data-invalid={!!fieldErrors.fromName || undefined}>
            <FieldLabel htmlFor="fromName">Sender name</FieldLabel>
            <Input id="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} aria-invalid={!!fieldErrors.fromName || undefined} />
            <FieldError errors={errs(fieldErrors, "fromName")} />
          </Field>
          <Field data-invalid={!!fieldErrors.fromEmail || undefined}>
            <FieldLabel htmlFor="fromEmail">Sender email</FieldLabel>
            <Input id="fromEmail" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} aria-invalid={!!fieldErrors.fromEmail || undefined} />
            <FieldError errors={errs(fieldErrors, "fromEmail")} />
          </Field>
          <Field data-invalid={!!fieldErrors.dailyCap || undefined}>
            <FieldLabel htmlFor="dailyCap">Daily cap</FieldLabel>
            <Input id="dailyCap" type="number" inputMode="numeric" min={1} max={1000} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} aria-invalid={!!fieldErrors.dailyCap || undefined} />
            <FieldDescription>Most emails sent per day (1–1000), counted in the app time zone.</FieldDescription>
            <FieldError errors={errs(fieldErrors, "dailyCap")} />
          </Field>
        </FieldGroup>
      </PageSection>

      <PageSection
        title="Steps"
        description="Each step waits its delay after the previous one. Step 1 sends as soon as a business is enrolled."
      >
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs font-medium">Tokens</span>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  title={t.description}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertToken(t.token)}
                  className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                >
                  {`{{${t.token}}}`}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Click a token to insert it at the cursor. Unknown tokens render as blank; owner_first_name is blank when the owner is unknown.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="preview-business" className="text-xs font-medium">
              Preview as
            </label>
            {previewBusinesses.length ? (
              <Select value={previewId} onValueChange={setPreviewId}>
                <SelectTrigger id="preview-business" size="sm" className="max-w-full min-w-0 sm:w-72">
                  <SelectValue placeholder="Choose a business" />
                </SelectTrigger>
                <SelectContent>
                  {previewBusinesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {b.city ? ` · ${b.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">No businesses with an email to preview against.</span>
            )}
          </div>
        </div>

        {fieldErrors.steps ? <FieldError errors={errs(fieldErrors, "steps")} /> : null}

        <AnimatedList className="flex flex-col gap-3">
          {steps.map((s, i) => {
            const k = (f: string) => `steps.${i}.${f}`;
            return (
              <AnimatedItem key={s.key} layout="position">
                <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4" aria-label={`Step ${i + 1}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    {i === 0 ? (
                      <span className="text-xs text-muted-foreground">Sends immediately on enrollment</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <label htmlFor={`delay-${s.key}`}>Wait</label>
                        <Input
                          id={`delay-${s.key}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={60}
                          value={s.delayDays}
                          onChange={(e) => updateStep(s.key, { delayDays: e.target.value })}
                          className="h-7 w-16"
                          aria-invalid={!!fieldErrors[k("delayDays")] || undefined}
                        />
                        <span>days after step {i}</span>
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>
                        <ArrowUpIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`}>
                        <ArrowDownIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeStep(s.key)} disabled={steps.length === 1} aria-label={`Remove step ${i + 1}`}>
                        <Trash2Icon />
                      </Button>
                    </span>
                  </div>
                  <FieldError errors={errs(fieldErrors, k("delayDays"))} />
                  <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-3">
                      <Field data-invalid={!!fieldErrors[k("subject")] || undefined}>
                        <FieldLabel htmlFor={`subject-${s.key}`}>Subject</FieldLabel>
                        <Input
                          id={`subject-${s.key}`}
                          value={s.subject}
                          onChange={(e) => updateStep(s.key, { subject: e.target.value })}
                          onFocus={(e) => (lastFocus.current = { key: s.key, field: "subject", el: e.currentTarget })}
                          aria-invalid={!!fieldErrors[k("subject")] || undefined}
                        />
                        <FieldError errors={errs(fieldErrors, k("subject"))} />
                      </Field>
                      <Field data-invalid={!!fieldErrors[k("body")] || undefined}>
                        <FieldLabel htmlFor={`body-${s.key}`}>Body</FieldLabel>
                        <Textarea
                          id={`body-${s.key}`}
                          rows={6}
                          value={s.body}
                          onChange={(e) => updateStep(s.key, { body: e.target.value })}
                          onFocus={(e) => (lastFocus.current = { key: s.key, field: "body", el: e.currentTarget })}
                          aria-invalid={!!fieldErrors[k("body")] || undefined}
                        />
                        <FieldError errors={errs(fieldErrors, k("body"))} />
                      </Field>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-dashed bg-muted/30 p-3" aria-live="polite">
                      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Preview</span>
                      {preview ? (
                        <>
                          <p className="text-sm font-medium break-words">{renderTemplate(s.subject, preview) || <span className="text-muted-foreground">(no subject)</span>}</p>
                          <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{renderTemplate(s.body, preview)}</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Pick a business above to preview.</p>
                      )}
                    </div>
                  </div>
                </fieldset>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
        <div>
          <Button type="button" variant="outline" onClick={addStep} disabled={steps.length >= 20}>
            <PlusIcon data-icon="inline-start" />
            Add step
          </Button>
        </div>
      </PageSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {formError ? (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : campaignId ? "Save changes" : "Create campaign"}
        </Button>
      </div>
    </form>
  );
}
