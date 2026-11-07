import { z } from "zod";

export const stepSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required"),
  body: z.string().trim().min(1, "Body is required"),
  delayDays: z.coerce
    .number({ error: "Enter a number of days" })
    .int("Whole days only")
    .min(0, "0 to 60 days")
    .max(60, "0 to 60 days"),
});

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    fromName: z.string().trim().min(1, "Sender name is required").max(200),
    fromEmail: z.string().trim().pipe(z.email("Enter a valid email address")),
    dailyCap: z.coerce
      .number({ error: "Enter a number" })
      .int("Whole number only")
      .min(1, "Between 1 and 1000")
      .max(1000, "Between 1 and 1000"),
    steps: z.array(stepSchema).min(1, "Add at least one step").max(20, "At most 20 steps"),
  })
  .superRefine((v, ctx) => {
    if (v.steps.length && v.steps[0].delayDays !== 0) {
      ctx.addIssue({ code: "custom", path: ["steps", 0, "delayDays"], message: "The first step sends immediately (delay 0)" });
    }
  });

export type CampaignInput = z.input<typeof campaignSchema>;
export type CampaignValues = z.output<typeof campaignSchema>;

/** Flatten zod issues to `{ "steps.0.subject": [...] }` for ActionResult.fieldErrors. */
export function issuesToFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export const enrollFilterSchema = z.object({
  qualifiedOnly: z.boolean().default(true),
  hasEmail: z.boolean().default(true),
  excludeDoNotEmail: z.boolean().default(true),
  city: z.string().trim().max(200).optional(),
  category: z.string().trim().max(200).optional(),
});

export type EnrollFilter = z.input<typeof enrollFilterSchema>;
