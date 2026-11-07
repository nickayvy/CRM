"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { logNoteAction } from "../actions";
import { errorsFor, useFormAction } from "./crm-form";

/** Adds a note activity; clears itself after a successful save. */
export function NoteForm({ businessId }: { businessId: string }) {
  const action = React.useMemo(() => logNoteAction.bind(null, businessId), [businessId]);
  const { state, pending, onSubmit } = useFormAction(action);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const error = errorsFor(state, "body") ?? (state && !state.ok && !state.fieldErrors ? state.message : undefined);

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-label="Add a note" className="flex flex-col gap-2">
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="note-body" className="sr-only">
          Note
        </FieldLabel>
        <Textarea
          id="note-body"
          name="body"
          rows={3}
          placeholder="Add a note…"
          aria-invalid={error ? true : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
