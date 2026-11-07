"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { QualificationRules } from "@/db/schema";
import { errorsFor, useFormAction } from "@/features/businesses/components/crm-form";
import { updateRulesAction } from "@/features/ingest/actions";

/** Editor for the single qualification rules row on /settings/rules. */
export function RulesForm({ rules }: { rules: QualificationRules }) {
  const { state, pending, onSubmit } = useFormAction(updateRulesAction);

  React.useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Rules saved");
    else if (!state.fieldErrors) toast.error(state.message ?? "Could not save the rules.");
  }, [state]);

  const err = (name: string) => errorsFor(state, name);
  const invalid = (name: string) => (err(name) ? true : undefined);

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Qualification rules">
      <FieldGroup className="gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={invalid("minRating")}>
            <FieldLabel htmlFor="rules-min-rating">Minimum rating</FieldLabel>
            <Input
              id="rules-min-rating"
              name="minRating"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={0}
              max={5}
              defaultValue={rules.minRating}
              aria-invalid={invalid("minRating")}
            />
            <FieldDescription>Reject businesses rated below this (0 to 5). No rating counts as 0.</FieldDescription>
            {err("minRating") ? <FieldError>{err("minRating")}</FieldError> : null}
          </Field>
          <Field data-invalid={invalid("minReviews")}>
            <FieldLabel htmlFor="rules-min-reviews">Minimum reviews</FieldLabel>
            <Input
              id="rules-min-reviews"
              name="minReviews"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              defaultValue={rules.minReviews}
              aria-invalid={invalid("minReviews")}
            />
            <FieldDescription>Reject businesses with fewer reviews than this.</FieldDescription>
            {err("minReviews") ? <FieldError>{err("minReviews")}</FieldError> : null}
          </Field>
          <Field data-invalid={invalid("maxReviews")}>
            <FieldLabel htmlFor="rules-max-reviews">Maximum reviews</FieldLabel>
            <Input
              id="rules-max-reviews"
              name="maxReviews"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              defaultValue={rules.maxReviews ?? ""}
              placeholder="No maximum"
              aria-invalid={invalid("maxReviews")}
            />
            <FieldDescription>Reject businesses with more reviews than this. Leave blank for no maximum.</FieldDescription>
            {err("maxReviews") ? <FieldError>{err("maxReviews")}</FieldError> : null}
          </Field>
        </div>

        <div className="flex flex-col gap-4">
          <Field orientation="horizontal">
            <Checkbox id="rules-require-phone" name="requirePhone" defaultChecked={rules.requirePhone} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="rules-require-phone">Require a phone number</FieldLabel>
              <FieldDescription>Reject businesses with no phone number, since we cannot call them.</FieldDescription>
            </div>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="rules-reject-closed" name="rejectClosed" defaultChecked={rules.rejectClosed} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="rules-reject-closed">Reject closed businesses</FieldLabel>
              <FieldDescription>Reject businesses Yelp marks as permanently closed.</FieldDescription>
            </div>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="rules-reject-chains" name="rejectChains" defaultChecked={rules.rejectChains} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="rules-reject-chains">Reject chains</FieldLabel>
              <FieldDescription>
                Reject names that match a chain pattern below, or that appear in at least as many different cities as
                the multi-location threshold.
              </FieldDescription>
            </div>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="rules-category-strict" name="categoryStrict" defaultChecked={rules.categoryStrict} />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="rules-category-strict">Strict category match</FieldLabel>
              <FieldDescription>
                Reject businesses none of whose categories match the categories the search asked for.
              </FieldDescription>
            </div>
          </Field>
        </div>

        <Field data-invalid={invalid("chainPatterns")}>
          <FieldLabel htmlFor="rules-chain-patterns">Chain patterns</FieldLabel>
          <Textarea
            id="rules-chain-patterns"
            name="chainPatterns"
            defaultValue={rules.chainPatterns.join("\n")}
            rows={8}
            spellCheck={false}
            className="font-mono text-xs"
            aria-invalid={invalid("chainPatterns")}
          />
          <FieldDescription>
            One pattern per line. A business is a chain if its name contains any pattern (not case-sensitive). Only used
            when &quot;Reject chains&quot; is on.
          </FieldDescription>
          {err("chainPatterns") ? <FieldError>{err("chainPatterns")}</FieldError> : null}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={invalid("distanceTolerancePct")}>
            <FieldLabel htmlFor="rules-distance-tolerance">Distance tolerance (%)</FieldLabel>
            <Input
              id="rules-distance-tolerance"
              name="distanceTolerancePct"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              max={100}
              defaultValue={rules.distanceTolerancePct}
              aria-invalid={invalid("distanceTolerancePct")}
            />
            <FieldDescription>
              How far past the search radius a business can be before it is rejected as out of area.
            </FieldDescription>
            {err("distanceTolerancePct") ? <FieldError>{err("distanceTolerancePct")}</FieldError> : null}
          </Field>
          <Field data-invalid={invalid("multiLocationThreshold")}>
            <FieldLabel htmlFor="rules-multi-location">Multi-location threshold</FieldLabel>
            <Input
              id="rules-multi-location"
              name="multiLocationThreshold"
              type="number"
              inputMode="numeric"
              step={1}
              min={2}
              max={100}
              defaultValue={rules.multiLocationThreshold}
              aria-invalid={invalid("multiLocationThreshold")}
            />
            <FieldDescription>
              Reject a name found in this many different cities or more (needs &quot;Reject chains&quot;).
            </FieldDescription>
            {err("multiLocationThreshold") ? <FieldError>{err("multiLocationThreshold")}</FieldError> : null}
          </Field>
          <Field data-invalid={invalid("reviewScoreBelow")}>
            <FieldLabel htmlFor="rules-review-score">Review score below</FieldLabel>
            <Input
              id="rules-review-score"
              name="reviewScoreBelow"
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              max={100}
              defaultValue={rules.reviewScoreBelow}
              aria-invalid={invalid("reviewScoreBelow")}
            />
            <FieldDescription>
              Businesses that pass every rule but score under this (0 to 100) are sent to review instead of qualified.
            </FieldDescription>
            {err("reviewScoreBelow") ? <FieldError>{err("reviewScoreBelow")}</FieldError> : null}
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save rules"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
