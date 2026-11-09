// Every app route server-renders on PGlite with a mocked signed-in user: no throw, a
// route-specific heading, no placeholder copy and none of the pre-restyle card classes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import type { Db } from "@/db/client";
import { upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { addBusinessesToCampaign, createCallCampaign } from "@/db/repo/call-campaigns";
import { createEmailCampaign, enrollBusinesses } from "@/db/repo/email-campaigns";
import { createSearchJob } from "@/db/repo/search-jobs";
import type { Business, CallCampaign, EmailCampaign, SearchJob } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { insertBusiness, makeTrustpilotRow } from "./helpers/builders";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const state = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  requireUserCalls: 0,
  agent: undefined as string | undefined,
}));

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => state.user,
  requireUser: async () => {
    state.requireUserCalls++;
    if (!state.user) throw new Error("NEXT_REDIRECT /login");
    return state.user;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "crm_agent" && state.agent ? { name, value: state.agent } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { default: LookupPage } = await import("@/app/lookup/page");
const { default: LeadsPage } = await import("@/app/leads/page");
const { default: BusinessesPage } = await import("@/app/businesses/page");
const { default: BusinessPage } = await import("@/app/businesses/[id]/page");
const { default: SearchesPage } = await import("@/app/searches/page");
const { default: NewSearchPage } = await import("@/app/searches/new/page");
const { default: SearchPage } = await import("@/app/searches/[id]/page");
const { default: CallingPage } = await import("@/app/calling/page");
const { default: NewCallingPage } = await import("@/app/calling/new/page");
const { default: CallingCampaignPage } = await import("@/app/calling/[id]/page");
const { default: DialPage } = await import("@/app/calling/[id]/dial/page");
const { default: CallingSettingsPage } = await import("@/app/calling/[id]/settings/page");
const { default: EmailPage } = await import("@/app/email/page");
const { default: NewEmailPage } = await import("@/app/email/new/page");
const { default: EmailCampaignPage } = await import("@/app/email/[id]/page");
const { default: EmailMessagesPage } = await import("@/app/email/[id]/messages/page");
const { default: EmailSettingsPage } = await import("@/app/email/[id]/settings/page");
const { default: SettingsPage } = await import("@/app/settings/page");
const { default: RulesPage } = await import("@/app/settings/rules/page");
const { default: OverviewPage } = await import("@/app/overview/page");
const { default: DesignPage } = await import("@/app/design/page");
const { TooltipProvider } = await import("@/components/ui/tooltip");

let db: Db;
let close: () => Promise<void>;
let yelp: Business;
let trustpilot: Business;
let callCampaign: CallCampaign;
let emailCampaign: EmailCampaign;
let job: SearchJob;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  globalThis.__db = { db, driver: "pglite", close };
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs RESTART IDENTITY CASCADE`);

  yelp = await insertBusiness(db, {
    name: "Bayou Plumbing Co",
    qualification: "qualified",
    score: 80,
    ownerEmail: "owner@bayou.example.test",
  });
  trustpilot = (
    await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({
        name: "Acme Gadgets",
        reviewsLast30d: 80,
        trustScore: "4.3",
        ownerEmail: "hello@acme.example.test",
        socialLinks: { facebook: "https://facebook.com/acme" },
      }),
    )
  ).business;
  job = await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
  callCampaign = await createCallCampaign(db, { name: "Houston plumbers", status: "draft" });
  await addBusinessesToCampaign(db, callCampaign.id, [yelp.id]);
  emailCampaign = await createEmailCampaign(db, {
    name: "Intro sequence",
    status: "draft",
    fromName: "Alex",
    fromEmail: "alex@example.com",
    dailyCap: 50,
    steps: [{ stepOrder: 1, delayDays: 0, subject: "Hello {{name}}", body: "Hi there" }],
  });
  await enrollBusinesses(db, emailCampaign.id, [yelp.id, trustpilot.id]);
});
afterAll(async () => {
  globalThis.__db = undefined;
  await close();
});
beforeEach(() => {
  state.user = { id: USER_ID, email: "sdr@example.test" };
  state.requireUserCalls = 0;
  state.agent = undefined;
});

/** Server-renders a page element as the root layout would (TooltipProvider) and returns its html. */
async function html(el: ReactNode): Promise<string> {
  const { prelude } = await prerender(createElement(TooltipProvider, null, el));
  return (await new Response(prelude).text()).replaceAll("<!-- -->", "");
}

const FORBIDDEN = ["fixture", "Built in WP", "bg-card", "rounded-xl border"];
function expectClean(out: string) {
  for (const s of FORBIDDEN) expect(out, `unexpected "${s}"`).not.toContain(s);
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const noSearch = Promise.resolve({} as Record<string, string | string[] | undefined>);

type Route = { path: string; render: () => Promise<ReactNode>; contains: () => string[] };
const ROUTES: Route[] = [
  { path: "/lookup", render: () => LookupPage({ searchParams: noSearch }), contains: () => ["Business network"] },
  { path: "/leads", render: () => LeadsPage(), contains: () => ["Leads"] },
  { path: "/businesses", render: () => BusinessesPage({ searchParams: noSearch }), contains: () => ["Businesses", "Bayou Plumbing Co", "Acme Gadgets"] },
  { path: "/businesses/[id] (yelp)", render: () => BusinessPage(idParams(yelp.id)), contains: () => ["Bayou Plumbing Co", 'data-testid="yelp-panel"'] },
  { path: "/businesses/[id] (trustpilot)", render: () => BusinessPage(idParams(trustpilot.id)), contains: () => ["Acme Gadgets", 'data-testid="trustpilot-panel"'] },
  { path: "/searches", render: () => SearchesPage(), contains: () => ["Searches", "Houston, TX"] },
  { path: "/searches/new", render: () => NewSearchPage(), contains: () => ["New search"] },
  { path: "/searches/[id]", render: () => SearchPage(idParams(job.id)), contains: () => ["plumbing in Houston, TX", "Progress"] },
  { path: "/calling", render: () => CallingPage(), contains: () => ["Calling", "Houston plumbers"] },
  { path: "/calling/new", render: () => NewCallingPage(), contains: () => ["New call campaign"] },
  { path: "/calling/[id]", render: () => CallingCampaignPage(idParams(callCampaign.id)), contains: () => ["Houston plumbers", "Queue", "Open dialer"] },
  { path: "/calling/[id]/dial (no agent)", render: () => DialPage(idParams(callCampaign.id)), contains: () => ["Houston plumbers", "Your name"] },
  { path: "/calling/[id]/settings", render: () => CallingSettingsPage(idParams(callCampaign.id)), contains: () => ["Settings", "Save changes"] },
  { path: "/email", render: () => EmailPage(), contains: () => ["Email", "Intro sequence"] },
  { path: "/email/new", render: () => NewEmailPage(), contains: () => ["New email campaign"] },
  { path: "/email/[id]", render: () => EmailCampaignPage({ ...idParams(emailCampaign.id), searchParams: noSearch }), contains: () => ["Intro sequence", "Enrollments"] },
  { path: "/email/[id]/messages", render: () => EmailMessagesPage({ ...idParams(emailCampaign.id), searchParams: noSearch }), contains: () => ["Message log", "Intro sequence"] },
  { path: "/email/[id]/settings", render: () => EmailSettingsPage(idParams(emailCampaign.id)), contains: () => ["Settings", "Intro sequence"] },
  { path: "/settings", render: () => SettingsPage(), contains: () => ["Settings", "Workspace", "Sources"] },
  { path: "/settings/rules", render: () => RulesPage(), contains: () => ["Qualification rules"] },
  { path: "/overview", render: () => OverviewPage(), contains: () => ["Overview", "Businesses by source"] },
  { path: "/design", render: async () => DesignPage(), contains: () => ["LAR design system"] },
];

describe("route server render", () => {
  for (const r of ROUTES) {
    it(`${r.path} renders`, async () => {
      const out = await html(await r.render());
      for (const s of r.contains()) expect(out).toContain(s);
      expectClean(out);
    });
  }

  it("/calling/[id]/dial renders the dialer when the agent cookie is set", async () => {
    state.agent = "ann";
    const out = await html(await DialPage(idParams(callCampaign.id)));
    expect(out).toContain("Houston plumbers");
    expect(out).toMatch(/<\/svg> ann</);
    expect(out).not.toContain("agent-name");
    expectClean(out);
  });

  it("/calling/[id]/dial asks for the agent name without the cookie", async () => {
    state.agent = undefined;
    const out = await html(await DialPage(idParams(callCampaign.id)));
    expect(out).toContain("Houston plumbers");
    expect(out).toContain("Your name");
    expect(out).toContain("agent-name");
    expectClean(out);
  });

  it("every page except /design calls requireUser", async () => {
    for (const r of ROUTES) {
      if (r.path === "/design") continue;
      state.requireUserCalls = 0;
      await html(await r.render());
      expect(state.requireUserCalls, r.path).toBeGreaterThan(0);
    }
    state.requireUserCalls = 0;
    await html(await DesignPage());
    expect(state.requireUserCalls).toBe(0);
  });

  it("pages reject when signed out", async () => {
    state.user = null;
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    await expect(CallingPage()).rejects.toThrow("NEXT_REDIRECT");
  });
});
