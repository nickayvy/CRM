// Validation for calling forms and payloads. Shared by actions and tests.
import { z } from "zod";
import type { BusinessFilter } from "@/db/repo/businesses";
import { CALL_OUTCOMES } from "./types";
import { isValidTimeZone, normalizeTime } from "./time";

export function fieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const blankToUndefined = (v: unknown) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v);
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v);

const intIn = (min: number, max: number, label: string, fallback: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} must be a number` })
      .int(`${label} must be a whole number`)
      .min(min, `${label} must be between ${min} and ${max}`)
      .max(max, `${label} must be between ${min} and ${max}`)
      .default(fallback),
  );

const timeField = z.preprocess(
  blankToUndefined,
  z
    .string()
    .refine((v) => normalizeTime(v) !== null, "Use a time like 09:00")
    .transform((v) => normalizeTime(v)!.slice(0, 5))
    .optional(),
);

export const campaignFormSchema = z
  .object({
    mode: z.preprocess((v) => (v === "ai" ? "ai" : "human"), z.enum(["human", "ai"])),
    name: z.preprocess(trimmed, z.string({ error: "Name is required" }).min(1, "Name is required").max(120)),
    description: z.preprocess(blankToUndefined, z.string().trim().max(500).optional()),
    script: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(20000, "Script is too long")),
    dailyCap: z.preprocess(
      blankToUndefined,
      z.coerce
        .number({ error: "Daily cap must be a number" })
        .int("Daily cap must be a whole number")
        .min(1, "Daily cap must be at least 1 (leave empty for no cap)")
        .max(100000)
        .optional(),
    ),
    callingHoursStart: timeField,
    callingHoursEnd: timeField,
    timezone: z.preprocess(
      trimmed,
      z.string({ error: "Time zone is required" }).refine(isValidTimeZone, "Pick a valid IANA time zone"),
    ),
    maxConcurrentAgents: intIn(1, 50, "Max agents", 5),
    maxAttempts: intIn(1, 10, "Max attempts", 3),
    autoResume: z.preprocess((v) => v === "on" || v === "true" || v === true || v === "1", z.boolean()),
  })
  .superRefine((v, ctx) => {
    const hasStart = v.callingHoursStart !== undefined;
    const hasEnd = v.callingHoursEnd !== undefined;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: "custom",
        path: [hasStart ? "callingHoursEnd" : "callingHoursStart"],
        message: "Set both start and end, or neither",
      });
    } else if (hasStart && v.callingHoursStart === v.callingHoursEnd) {
      ctx.addIssue({ code: "custom", path: ["callingHoursEnd"], message: "End must differ from start" });
    }
  });

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;

const FORM_KEYS = [
  "mode",
  "name",
  "description",
  "script",
  "dailyCap",
  "callingHoursStart",
  "callingHoursEnd",
  "timezone",
  "maxConcurrentAgents",
  "maxAttempts",
  "autoResume",
] as const;

export function parseCampaignForm(formData: FormData) {
  const raw: Record<string, unknown> = {};
  for (const k of FORM_KEYS) raw[k] = formData.get(k) ?? undefined;
  return campaignFormSchema.safeParse(raw);
}

/** Form values → repo columns (blank → null). */
export function toCampaignColumns(v: CampaignFormValues) {
  return {
    mode: v.mode,
    name: v.name,
    description: v.description ?? null,
    script: v.script,
    dailyCap: v.dailyCap ?? null,
    callingHoursStart: v.callingHoursStart ?? null,
    callingHoursEnd: v.callingHoursEnd ?? null,
    timezone: v.timezone,
    maxConcurrentAgents: v.maxConcurrentAgents,
    maxAttempts: v.maxAttempts,
    autoResume: v.autoResume,
  };
}

/** The subset of BusinessFilter the "Add businesses" panel sends. */
export const addFilterSchema = z.object({
  qualification: z.array(z.enum(["qualified", "review", "rejected"])).max(3).optional(),
  hasPhone: z.boolean().optional(),
  excludeDoNotCall: z.boolean().optional(),
  city: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  q: z.string().trim().max(200).optional(),
  /** Restrict to businesses on the signed-in user's lead list. */
  onlyMyLeads: z.boolean().optional(),
});

export type AddFilter = z.infer<typeof addFilterSchema>;

export function toBusinessFilter(f: AddFilter): BusinessFilter {
  return {
    ...(f.qualification?.length ? { qualification: f.qualification } : {}),
    ...(f.hasPhone ? { hasPhone: true } : {}),
    ...(f.excludeDoNotCall ? { excludeDoNotCall: true } : {}),
    ...(f.city ? { city: f.city } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.minScore !== undefined && f.minScore > 0 ? { minScore: f.minScore } : {}),
    ...(f.q ? { q: f.q } : {}),
  };
}

export const addInputSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(10000) }),
  z.object({ filter: addFilterSchema }),
]);

export const outcomeSchema = z.enum(CALL_OUTCOMES);
