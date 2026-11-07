"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Business, BusinessStatus } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import { STATUS_LABELS } from "@/lib/labels";
import { updateBusinessCrmAction } from "../actions";

export type CrmFormValues = Pick<
  Business,
  "id" | "status" | "ownerName" | "ownerEmail" | "tags" | "doNotCall" | "doNotEmail" | "notes"
> & {
  /** `datetime-local` value in APP_TIMEZONE, or "". */
  nextFollowUpLocal: string;
};

/** Field errors for `name` from an ActionResult. */
export function errorsFor<T>(state: ActionResult<T> | null, name: string): string | undefined {
  return state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
}

/**
 * Submits with `useActionState` but through `onSubmit`, so React does not
 * reset the uncontrolled fields after the action (keeps the user's input when
 * validation fails).
 */
export function useFormAction<T>(action: (prev: ActionResult<T> | null, fd: FormData) => Promise<ActionResult<T>>) {
  const [state, formAction, pending] = React.useActionState(action, null);
  const onSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      React.startTransition(() => formAction(fd));
    },
    [formAction],
  );
  return { state, pending, onSubmit };
}

/** CRM panel on /businesses/[id]: status, owner, tags, do-not flags, follow-up, notes. */
export function CrmForm({ values }: { values: CrmFormValues }) {
  const action = React.useMemo(() => updateBusinessCrmAction.bind(null, values.id), [values.id]);
  const { state, pending, onSubmit } = useFormAction(action);

  React.useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Saved");
    else if (!state.fieldErrors) toast.error(state.message ?? "Could not save.");
  }, [state]);

  const err = (name: string) => errorsFor(state, name);

  return (
    <form onSubmit={onSubmit} noValidate aria-label="CRM details">
      <FieldGroup className="gap-4">
        <Field data-invalid={err("status") ? true : undefined}>
          <FieldLabel htmlFor="crm-status">Status</FieldLabel>
          <Select name="status" defaultValue={values.status}>
            <SelectTrigger id="crm-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS) as BusinessStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("status") ? <FieldError>{err("status")}</FieldError> : null}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={err("ownerName") ? true : undefined}>
            <FieldLabel htmlFor="crm-owner-name">Owner name</FieldLabel>
            <Input id="crm-owner-name" name="ownerName" defaultValue={values.ownerName ?? ""} autoComplete="off" />
            {err("ownerName") ? <FieldError>{err("ownerName")}</FieldError> : null}
          </Field>
          <Field data-invalid={err("ownerEmail") ? true : undefined}>
            <FieldLabel htmlFor="crm-owner-email">Owner email</FieldLabel>
            <Input
              id="crm-owner-email"
              name="ownerEmail"
              type="email"
              defaultValue={values.ownerEmail ?? ""}
              aria-invalid={err("ownerEmail") ? true : undefined}
              autoComplete="off"
            />
            {err("ownerEmail") ? <FieldError>{err("ownerEmail")}</FieldError> : null}
          </Field>
        </div>
        <Field data-invalid={err("tags") ? true : undefined}>
          <FieldLabel htmlFor="crm-tags">Tags</FieldLabel>
          <Input id="crm-tags" name="tags" defaultValue={values.tags.join(", ")} placeholder="vip, spring-promo" />
          <FieldDescription>Comma-separated.</FieldDescription>
          {err("tags") ? <FieldError>{err("tags")}</FieldError> : null}
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Field orientation="horizontal" className="w-auto">
            <Checkbox id="crm-dnc" name="doNotCall" defaultChecked={values.doNotCall} />
            <FieldLabel htmlFor="crm-dnc">Do not call</FieldLabel>
          </Field>
          <Field orientation="horizontal" className="w-auto">
            <Checkbox id="crm-dne" name="doNotEmail" defaultChecked={values.doNotEmail} />
            <FieldLabel htmlFor="crm-dne">Do not email</FieldLabel>
          </Field>
        </div>
        <Field data-invalid={err("nextFollowUpAt") ? true : undefined}>
          <FieldLabel htmlFor="crm-follow-up">Next follow-up</FieldLabel>
          <Input id="crm-follow-up" name="nextFollowUpAt" type="datetime-local" defaultValue={values.nextFollowUpLocal} />
          {err("nextFollowUpAt") ? <FieldError>{err("nextFollowUpAt")}</FieldError> : null}
        </Field>
        <Field data-invalid={err("notes") ? true : undefined}>
          <FieldLabel htmlFor="crm-notes">Notes</FieldLabel>
          <Textarea id="crm-notes" name="notes" defaultValue={values.notes ?? ""} rows={4} />
          {err("notes") ? <FieldError>{err("notes")}</FieldError> : null}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
