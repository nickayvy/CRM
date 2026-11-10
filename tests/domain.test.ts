// websiteDomain / isSharedHost (duplicate_website and cross-source matching).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { rowsOf } from "@/features/ingest/context";
import { isSharedHost, matchableDomain, websiteDomain } from "@/lib/domain";
import { makeBusinessRow } from "./helpers/builders";

const CASES: [string | null | undefined, string | null][] = [
  ["https://www.Acme.com/x", "acme.com"],
  ["http://acme.com", "acme.com"],
  ["acme.com", "acme.com"],
  ["www.acme.com/contact?x=1#top", "acme.com"],
  ["HTTPS://WWW.ACME.COM", "acme.com"],
  ["https://shop.acme.co.uk:8443/a", "shop.acme.co.uk"],
  ["https://acme.com./", "acme.com"],
  ["https://user:pw@acme.com/", "acme.com"],
  ["  https://acme-roofing.com  ", "acme-roofing.com"],
  ["https://www2.acme.com", "www2.acme.com"],
  ["https://acme.wixsite.com/roofing", "acme.wixsite.com"],
  ["Acme Roofing", null],
  ["localhost", null],
  ["mailto:info@acme.com", null],
  ["", null],
  [null, null],
  [undefined, null],
];

describe("websiteDomain", () => {
  it.each(CASES)("%s → %s", (input, expected) => {
    expect(websiteDomain(input)).toBe(expected);
  });
});

describe("isSharedHost", () => {
  it("is true for shared hosts and their subdomains, false otherwise", () => {
    for (const d of ["facebook.com", "m.facebook.com", "instagram.com", "linktr.ee", "yelp.com", "google.com", "sites.google.com", "business.site", "acme.business.site", "acme.wixsite.com", "squarespace.com", "godaddysites.com", "weebly.com", "gmail.com", "www.facebook.com"])
      expect(isSharedHost(d), d).toBe(true);
    for (const d of ["acme.com", "notfacebook.com", "facebook.com.evil.io", "myyelp.com", ""])
      expect(isSharedHost(d), d).toBe(false);
  });

  it("matchableDomain drops shared hosts", () => {
    expect(matchableDomain("https://www.facebook.com/acme")).toBeNull();
    expect(matchableDomain("https://www.acme.com")).toBe("acme.com");
    expect(matchableDomain(null)).toBeNull();
  });
});

describe("websiteDomain agrees with the generated column", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  it("for every case", async () => {
    for (const [input] of CASES) {
      if (input === undefined) continue;
      const [row] = await db.insert(businesses).values(makeBusinessRow({ website: input })).returning();
      const [r] = rowsOf<{ d: string | null }>(
        await db.execute(sql`SELECT website_domain AS d FROM businesses WHERE id = ${row.id}`),
      );
      expect(r.d, String(input)).toBe(websiteDomain(input));
      expect(row.websiteDomain).toBe(websiteDomain(input));
    }
  });
});
