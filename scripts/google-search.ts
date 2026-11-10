// Google Maps (Places API New) search CLI. Plans niche × zip searches, runs
// the job in slices until it completes, pauses or fails, and prints one line
// per search. Requires GOOGLE_PLACES_API_KEY except for --dry-run.
//   npm run google:search -- --niche roofing --area "75201,75202" [--terms "a,b"] [--max-pages 3] [--dry-run]
//   npm run google:search -- --probe "roofer 75201"     # one request, prints mapped rows, writes nothing
//   npm run google:search -- --resume <jobId>
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Db } from "@/db/client";
import { GOOGLE_PLACES_PROVIDER, createGoogleJob, getUsage, reserveUsage } from "@/db/repo/google";
import { getSearchJob } from "@/db/repo/search-jobs";
import type { SearchJob } from "@/db/schema";
import { type SearchEvent, type SliceOutcome, runGoogleJobSlice } from "@/features/google/run";
import { GOOGLE_NOT_CONFIGURED, createPlacesClient } from "@/lib/google-places/client";
import { GEOCODING_PROVIDER, createGeocoder } from "@/lib/google-places/geocode";
import { NICHES } from "@/lib/google-places/niches";
import { normalizeGooglePlace } from "@/lib/google-places/normalize";
import { ZIP_BIAS_RADIUS_M, type PlanInput, type PlanPreview, planGoogleSearch } from "@/lib/google-places/plan";
import type { PlacesClient } from "@/lib/google-places/types";
import { zipCentre } from "@/lib/google-places/zips";

export const USAGE = [
  'Usage: npm run google:search -- --niche roofing --area "75201,75202" [--terms "a,b"] [--max-pages 1|2|3] [--dry-run]',
  '       npm run google:search -- --probe "roofer 75201"',
  "       npm run google:search -- --resume <jobId>",
  `Niches: ${NICHES.map((n) => n.id).join(", ")}`,
].join("\n");

/** Slice budget for the CLI (the same 240 s the web actions use). */
export const CLI_SLICE_BUDGET_MS = 240_000;

export type CliArgs =
  | { mode: "help" }
  | { mode: "search"; input: PlanInput; dryRun: boolean }
  | { mode: "probe"; query: string }
  | { mode: "resume"; jobId: string };

/** Parses argv (without node and script); throws an Error with a user-facing message. */
export function parseGoogleArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      niche: { type: "string", short: "n" },
      terms: { type: "string", short: "t" },
      area: { type: "string", short: "a" },
      "max-pages": { type: "string" },
      "dry-run": { type: "boolean" },
      probe: { type: "string" },
      resume: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { mode: "help" };
  const modes = [values.probe !== undefined, values.resume !== undefined, values.area !== undefined].filter(Boolean).length;
  if (modes > 1) throw new Error("Use one of --area, --probe or --resume.");
  if (values.probe !== undefined) {
    const query = values.probe.trim();
    if (!query) throw new Error("--probe needs a text query, e.g. \"roofer 75201\".");
    return { mode: "probe", query };
  }
  if (values.resume !== undefined) {
    const jobId = values.resume.trim();
    if (!jobId) throw new Error("--resume needs a job id.");
    return { mode: "resume", jobId };
  }
  const area = values.area?.trim();
  if (!area) throw new Error("--area is required (zip codes, \"City, ST\" or \"<zip> +<n>mi\").");
  const terms = values.terms !== undefined ? values.terms.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (!values.niche && !terms?.length) throw new Error("--niche or --terms is required.");
  let maxPagesPerQuery: 1 | 2 | 3 | undefined;
  if (values["max-pages"] !== undefined) {
    const n = Number(values["max-pages"]);
    if (n !== 1 && n !== 2 && n !== 3) throw new Error("--max-pages must be 1, 2 or 3.");
    maxPagesPerQuery = n;
  }
  return {
    mode: "search",
    dryRun: Boolean(values["dry-run"]),
    input: { nicheId: values.niche?.trim() || null, ...(terms?.length ? { terms } : {}), area, ...(maxPagesPerQuery ? { maxPagesPerQuery } : {}) },
  };
}

export type CliDeps = {
  apiKey: string | undefined;
  geocodingKey: string | undefined;
  cap: number;
  /** Only called once a key is known to be present. */
  createClient: (apiKey: string) => PlacesClient;
  /** Only called for modes that write (search without --dry-run, resume). */
  getDb: () => Promise<Db>;
  log: (line: string) => void;
  error: (line: string) => void;
  sliceBudgetMs?: number;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export function formatPlan(p: PlanPreview): string[] {
  const zips = p.plan.zips;
  return [
    `Terms (${p.plan.terms.length}): ${p.plan.terms.join(", ")}`,
    `Area: ${p.plan.areaLabel} — ${zips.length} zip${zips.length === 1 ? "" : "s"}: ${zips.slice(0, 20).join(", ")}${zips.length > 20 ? `, … (+${zips.length - 20})` : ""}`,
    `Searches: ${p.plan.terms.length} terms × ${zips.length} zips = ${p.queries}`,
    `Max requests: ${p.maxRequests} (${p.plan.maxPagesPerQuery} page${p.plan.maxPagesPerQuery === 1 ? "" : "s"} per search)`,
    `Estimated max cost: ${usd(p.estMaxUsd)}`,
    `Accepted place types: ${p.plan.acceptTypes.length ? p.plan.acceptTypes.join(", ") : "(any; no category rule)"}`,
  ];
}

function searchLine(e: SearchEvent): string {
  const n = String(e.index + 1).padStart(String(e.total).length);
  const tail = e.error ? `skipped: ${e.error}` : `${e.places} new place${e.places === 1 ? "" : "s"}${e.saturated ? " (saturated)" : ""}`;
  return `  [${n}/${e.total}] "${e.term}" in ${e.zip}: ${e.requests} request${e.requests === 1 ? "" : "s"}, ${tail}`;
}

function jobSummary(job: SearchJob): string {
  return `  ${job.queriesDone}/${job.queriesTotal} searches · ${job.fetchedCount} places (${job.newCount} new, ${job.matchedCount} matched) · qualified ${job.qualifiedCount} · review ${job.reviewCount} · rejected ${job.rejectedCount} · requests ${job.apiCalls}`;
}

async function loopSlices(db: Db, client: PlacesClient, jobId: string, deps: CliDeps): Promise<number> {
  let outcome: SliceOutcome = "more";
  let job: SearchJob | null = null;
  while (outcome === "more") {
    const before = job?.queriesDone ?? -1;
    const r = await runGoogleJobSlice(db, client, jobId, {
      budgetMs: deps.sliceBudgetMs ?? CLI_SLICE_BUDGET_MS,
      cap: deps.cap,
      onSearch: (e) => deps.log(searchLine(e)),
    });
    outcome = r.outcome;
    job = r.job;
    // A slice whose budget ran out before its first search: stop rather than spin.
    if (outcome === "more" && job.queriesDone === before) {
      deps.error("No progress in the last slice (budget too small); stopping. Resume with --resume.");
      break;
    }
  }
  deps.log(`Job ${jobId} ${outcome === "completed" ? "completed" : outcome === "failed" ? "failed" : `paused (${outcome})`}`);
  if (job) {
    deps.log(jobSummary(job));
    if (job.error) deps.log(`  ${job.error}`);
    if (job.plan?.saturated.length) deps.log(`  saturated searches (60 results; split the area further): ${job.plan.saturated.length}`);
    if (job.plan?.errors.length) deps.log(`  skipped searches: ${job.plan.errors.length}`);
  }
  deps.log(`Google requests this month: ${await getUsage(db, GOOGLE_PLACES_PROVIDER)} of ${deps.cap}`);
  if (outcome === "completed") return 0;
  if (outcome === "failed") return 1;
  if (outcome === "busy") deps.error("Another run holds this job; try again in two minutes.");
  return 3; // paused (capped, rate limited) or busy
}

/** Runs the CLI; returns the exit code. */
export async function runGoogleCli(argv: string[], deps: CliDeps): Promise<number> {
  let args: CliArgs;
  try {
    args = parseGoogleArgs(argv);
  } catch (err) {
    deps.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }
  if (args.mode === "help") {
    deps.log(USAGE);
    return 0;
  }

  if (args.mode === "search" && args.dryRun) {
    // Offline only: no key, no client, no database.
    try {
      const preview = await planGoogleSearch(args.input);
      for (const line of formatPlan(preview)) deps.log(line);
      deps.log(`Monthly request cap: ${deps.cap}`);
      deps.log("Dry run: no request sent, nothing written.");
      return 0;
    } catch (err) {
      deps.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  if (!deps.apiKey) {
    deps.error(GOOGLE_NOT_CONFIGURED);
    return 2;
  }
  const client = deps.createClient(deps.apiKey);

  if (args.mode === "probe") {
    const zip = /\b(\d{5})\b/.exec(args.query)?.[1];
    const centre = zip ? zipCentre(zip) : null;
    const res = await client.searchText({
      textQuery: args.query,
      ...(centre ? { locationBias: { ...centre, radiusM: ZIP_BIAS_RADIUS_M } } : {}),
      regionCode: "US",
    });
    deps.log(`Probe "${args.query}": ${res.places.length} place${res.places.length === 1 ? "" : "s"}${res.nextPageToken ? " (more pages available)" : ""}; nothing written.`);
    for (const p of res.places) {
      const row = normalizeGooglePlace(p, { searchCategory: "", searchLocation: "" });
      deps.log(
        [
          `- ${row.name}${row.name !== p.displayName?.text ? `  (raw: ${p.displayName?.text ?? ""})` : ""}`,
          `    phone ${row.phone ?? "—"} · website ${row.website ?? "—"} · rating ${row.rating ?? "—"} (${row.reviewCount ?? 0})${row.isClosed ? " · CLOSED" : ""}`,
          `    ${[row.address1, row.city, row.state, row.zip].filter(Boolean).join(", ") || "no address"} · category ${row.primaryCategory ?? "—"}`,
          `    types ${p.primaryType ?? "—"} | ${(p.types ?? []).join(", ")}`,
        ].join("\n"),
      );
    }
    return 0;
  }

  const db = await deps.getDb();
  if (args.mode === "resume") {
    const job = await getSearchJob(db, args.jobId);
    if (!job || job.source !== "google") {
      deps.error(`No Google search job ${args.jobId}`);
      return 2;
    }
    deps.log(`Resuming job ${job.id}: ${job.term ?? ""} in ${job.location} (${job.queriesDone}/${job.queriesTotal} searches done)`);
    return loopSlices(db, client, job.id, deps);
  }

  let preview: PlanPreview;
  try {
    const geocodingKey = deps.geocodingKey;
    preview = await planGoogleSearch(
      args.input,
      geocodingKey
        ? { geocode: createGeocoder(geocodingKey, { reserve: () => reserveUsage(db, GEOCODING_PROVIDER, deps.cap) }) }
        : undefined,
    );
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  for (const line of formatPlan(preview)) deps.log(line);
  const used = await getUsage(db, GOOGLE_PLACES_PROVIDER);
  deps.log(`Requests left this month: ${Math.max(0, deps.cap - used)} of ${deps.cap}`);
  const job = await createGoogleJob(db, preview);
  deps.log(`Job ${job.id} created`);
  return loopSlices(db, client, job.id, deps);
}

async function main() {
  const { env } = await import("@/lib/env");
  const { closeDb, getDb } = await import("@/db/client");
  const { runMigrations } = await import("@/db/migrate");
  let opened = false;
  const code = await runGoogleCli(process.argv.slice(2), {
    apiKey: env.GOOGLE_PLACES_API_KEY,
    geocodingKey: env.GOOGLE_GEOCODING_API_KEY,
    cap: env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP,
    createClient: (key) => createPlacesClient(key),
    getDb: async () => {
      const db = getDb();
      opened = true;
      await runMigrations(db);
      const target = env.DATABASE_URL ? "Postgres (DATABASE_URL)" : `PGlite at ${env.PGLITE_DATA_DIR}`;
      console.log(`Database: ${target}`);
      return db;
    },
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  }).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  });
  if (opened) await closeDb().catch(() => {});
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
