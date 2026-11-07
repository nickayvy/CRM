import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatPhone, formatRating, formatRelative, normalizeName, phoneDigits } from "@/lib/format";

describe("normalizeName", () => {
  it.each([
    ["Reliable Plumbing Co", "reliable plumbing"],
    ["New Guy Plumbing LLC", "new guy plumbing"],
    ["ABC Plumbing, Inc.", "abc plumbing"],
    ["  Hank's   Pipes ", "hanks pipes"],
    ["Roto-Rooter Plumbing & Water Cleanup", "roto rooter plumbing water cleanup"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it("strips each legal suffix", () => {
    for (const s of ["llc", "inc", "co", "corp", "ltd"]) {
      expect(normalizeName(`Acme Plumbing ${s.toUpperCase()}.`)).toBe("acme plumbing");
    }
  });

  it("only drops suffixes at the end", () => {
    expect(normalizeName("Co Op Plumbing")).toBe("co op plumbing");
  });

  it("is idempotent", () => {
    const once = normalizeName("ABC Plumbing, Inc.");
    expect(normalizeName(once)).toBe(once);
  });

  it("returns empty string for empty input", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("phoneDigits", () => {
  it("strips formatting", () => {
    expect(phoneDigits("+1 (713) 555-0123")).toBe("17135550123");
    expect(phoneDigits("+17135550123")).toBe("17135550123");
  });
  it("returns null for empty, null, or digit-less input", () => {
    expect(phoneDigits("")).toBeNull();
    expect(phoneDigits(null)).toBeNull();
    expect(phoneDigits("n/a")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formats E.164 NANP numbers", () => {
    expect(formatPhone("+17135550123")).toBe("(713) 555-0123");
  });
  it("formats 10-digit and punctuated numbers", () => {
    expect(formatPhone("7135550123")).toBe("(713) 555-0123");
    expect(formatPhone("1-713-555-0123")).toBe("(713) 555-0123");
  });
  it("returns empty string for null and empty", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
  });
  it("returns non-NANP numbers unchanged", () => {
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    expect(formatPhone("555-0123")).toBe("555-0123");
  });
});

describe("formatRating", () => {
  it("formats numbers and numeric strings to one decimal", () => {
    expect(formatRating(4.5)).toBe("4.5");
    expect(formatRating("4.5")).toBe("4.5");
    expect(formatRating(4)).toBe("4.0");
    expect(formatRating("3.5")).toBe("3.5");
  });
  it("returns an em dash for null, empty, or invalid", () => {
    expect(formatRating(null)).toBe("—");
    expect(formatRating("")).toBe("—");
    expect(formatRating("abc")).toBe("—");
    expect(formatRating(Number.NaN)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-11-07T20:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("says just now for under a minute (past or future)", () => {
    expect(formatRelative(ago(0), now)).toBe("just now");
    expect(formatRelative(ago(59_000), now)).toBe("just now");
    expect(formatRelative(ago(-30_000), now)).toBe("just now");
  });
  it("formats minutes, hours, days ago", () => {
    expect(formatRelative(ago(5 * MIN), now)).toBe("5 min ago");
    expect(formatRelative(ago(59 * MIN), now)).toBe("59 min ago");
    expect(formatRelative(ago(60 * MIN), now)).toBe("1 h ago");
    expect(formatRelative(ago(3 * HOUR), now)).toBe("3 h ago");
    expect(formatRelative(ago(24 * HOUR), now)).toBe("1 d ago");
    expect(formatRelative(ago(2 * DAY), now)).toBe("2 d ago");
    expect(formatRelative(ago(29 * DAY), now)).toBe("29 d ago");
  });
  it("formats the future with 'in'", () => {
    expect(formatRelative(ago(-3 * HOUR), now)).toBe("in 3 h");
    expect(formatRelative(ago(-10 * MIN), now)).toBe("in 10 min");
    expect(formatRelative(ago(-2 * DAY), now)).toBe("in 2 d");
  });
  it("accepts ISO strings", () => {
    expect(formatRelative("2026-11-07T19:55:00Z", now)).toBe("5 min ago");
  });
  it("falls back to an absolute date after 30 days", () => {
    const old = ago(30 * DAY);
    const out = formatRelative(old, now);
    expect(out).toBe(formatDate(old));
    expect(out).not.toMatch(/ago$/);
  });
});

describe("formatDate", () => {
  const d = new Date("2026-11-07T20:05:00Z");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("formats in an explicit timezone", () => {
    expect(formatDate(d, "America/Chicago")).toBe("Nov 7, 2026, 2:05 PM");
    expect(formatDate(d, "UTC")).toBe("Nov 7, 2026, 8:05 PM");
  });
  it("accepts ISO strings", () => {
    expect(formatDate("2026-11-07T20:05:00Z", "UTC")).toBe("Nov 7, 2026, 8:05 PM");
  });
  it("crosses the date line correctly", () => {
    expect(formatDate(new Date("2026-11-08T03:30:00Z"), "America/Chicago")).toBe("Nov 7, 2026, 9:30 PM");
  });
  it("defaults to America/Chicago", () => {
    vi.stubEnv("APP_TIMEZONE", "");
    expect(formatDate(d)).toBe("Nov 7, 2026, 2:05 PM");
  });
  it("honors APP_TIMEZONE when no tz is passed", () => {
    vi.stubEnv("APP_TIMEZONE", "UTC");
    expect(formatDate(d)).toBe("Nov 7, 2026, 8:05 PM");
  });
});
