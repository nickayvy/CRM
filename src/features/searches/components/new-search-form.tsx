"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorsFor, useFormAction } from "@/features/businesses/components/crm-form";
import { startSearchAction } from "@/features/ingest/actions";

export const COMMON_ALIASES = [
  "plumbing",
  "hvac",
  "electricians",
  "roofing",
  "landscaping",
  "dentists",
  "chiropractors",
  "autorepair",
  "hair",
  "homecleaning",
];

/** /searches/new: validates via `startSearchAction`, then navigates to the job page. */
export function NewSearchForm() {
  const router = useRouter();
  const { state, pending, onSubmit } = useFormAction(startSearchAction);

  React.useEffect(() => {
    if (!state) return;
    if (state.ok) router.push(`/searches/${state.data.jobId}`);
    else if (!state.fieldErrors) toast.error(state.message ?? "Could not start the search.");
  }, [state, router]);

  const err = (name: string) => errorsFor(state, name);
  const inv = (name: string) => (err(name) ? true : undefined);
  const navigating = pending || state?.ok === true;

  return (
    <form onSubmit={onSubmit} noValidate aria-label="New search">
      <FieldGroup className="gap-4">
        <Field data-invalid={inv("location")}>
          <FieldLabel htmlFor="search-location">Location</FieldLabel>
          <Input id="search-location" name="location" placeholder="Houston, TX" aria-invalid={inv("location")} required />
          <FieldDescription>City and state, e.g. “Houston, TX”.</FieldDescription>
          {err("location") ? <FieldError>{err("location")}</FieldError> : null}
        </Field>
        <Field data-invalid={inv("categoryAliases")}>
          <FieldLabel htmlFor="search-categories">Categories</FieldLabel>
          <Input
            id="search-categories"
            name="categoryAliases"
            placeholder="plumbing"
            aria-invalid={inv("categoryAliases")}
            autoCapitalize="off"
            spellCheck={false}
            required
          />
          <FieldDescription>
            Yelp category aliases, comma-separated. Common: {COMMON_ALIASES.join(", ")}.
          </FieldDescription>
          {err("categoryAliases") ? <FieldError>{err("categoryAliases")}</FieldError> : null}
        </Field>
        <Field data-invalid={inv("term")}>
          <FieldLabel htmlFor="search-term">Search term (optional)</FieldLabel>
          <Input id="search-term" name="term" placeholder="e.g. emergency" aria-invalid={inv("term")} />
          {err("term") ? <FieldError>{err("term")}</FieldError> : null}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={inv("radiusM")}>
            <FieldLabel htmlFor="search-radius">Radius (meters)</FieldLabel>
            <Input
              id="search-radius"
              name="radiusM"
              type="number"
              inputMode="numeric"
              min={500}
              max={40000}
              step={500}
              defaultValue={20000}
              aria-invalid={inv("radiusM")}
            />
            <FieldDescription>500 to 40,000 (Yelp’s maximum).</FieldDescription>
            {err("radiusM") ? <FieldError>{err("radiusM")}</FieldError> : null}
          </Field>
          <Field data-invalid={inv("maxResults")}>
            <FieldLabel htmlFor="search-max">Max results</FieldLabel>
            <Input
              id="search-max"
              name="maxResults"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              defaultValue={200}
              aria-invalid={inv("maxResults")}
            />
            <FieldDescription>1 to 1,000. Each 50 results is one API call.</FieldDescription>
            {err("maxResults") ? <FieldError>{err("maxResults")}</FieldError> : null}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={navigating}>
            {navigating ? "Starting…" : "Start search"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
