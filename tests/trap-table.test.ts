// Invariants of the v1 qualification trap table (tests/helpers/trap-table.ts). Other suites rely on these
// record counts, ids and names, so a careless edit to the builder data should fail here first.
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAIN_PATTERNS } from "@/db/repo/chain-patterns";
import { AUSTIN_DENTISTS, DALLAS_HVAC, HOUSTON_PLUMBERS, TRAP_DETAILS, TRAP_SEARCHES } from "./helpers/trap-table";

const ALL = [...HOUSTON_PLUMBERS, ...DALLAS_HVAC, ...AUSTIN_DENTISTS];
const matchesChainPattern = (name: string): boolean =>
  DEFAULT_CHAIN_PATTERNS.some((p) => name.toLowerCase().includes(p.toLowerCase()));

describe("trap table", () => {
  it("has 40 / 30 / 30 records, wired to the three search slugs", () => {
    expect([HOUSTON_PLUMBERS.length, DALLAS_HVAC.length, AUSTIN_DENTISTS.length]).toEqual([40, 30, 30]);
    expect(TRAP_SEARCHES["plumbing-houston"].records).toBe(HOUSTON_PLUMBERS);
    expect(TRAP_SEARCHES["hvac-dallas"].records).toBe(DALLAS_HVAC);
    expect(TRAP_SEARCHES["dentists-austin"].records).toBe(AUSTIN_DENTISTS);
  });

  it("ids are unique across all three sets", () => {
    expect(new Set(ALL.map((b) => b.id)).size).toBe(100);
  });

  it("aliases are unique across all three sets", () => {
    expect(new Set(ALL.map((b) => b.alias)).size).toBe(100);
  });

  it("ABC Plumbing appears once per set, in Houston, Dallas and Austin", () => {
    const abc = [HOUSTON_PLUMBERS, DALLAS_HVAC, AUSTIN_DENTISTS].map((set) => set.filter((b) => b.name === "ABC Plumbing"));
    for (const found of abc) expect(found).toHaveLength(1);
    expect(abc.map(([b]) => b.location.city)).toEqual(["Houston", "Dallas", "Austin"]);
    expect(new Set(abc.map(([b]) => b.id)).size).toBe(3);
  });

  it("names repeat only for ABC Plumbing (x3) and the Reliable Plumbing Co duplicate-phone pair", () => {
    const counts = new Map<string, number>();
    for (const b of ALL) counts.set(b.name.toLowerCase(), (counts.get(b.name.toLowerCase()) ?? 0) + 1);
    const dups = [...counts].filter(([, n]) => n > 1).sort();
    expect(dups).toEqual([
      ["abc plumbing", 3],
      ["reliable plumbing co", 2],
    ]);
  });

  it("the only shared phone is the Reliable Plumbing Co pair", () => {
    const counts = new Map<string, number>();
    for (const b of ALL) if (b.phone) counts.set(b.phone, (counts.get(b.phone) ?? 0) + 1);
    const shared = [...counts].filter(([, n]) => n > 1);
    const reliable = HOUSTON_PLUMBERS.filter((b) => b.name === "Reliable Plumbing Co");
    expect(reliable).toHaveLength(2);
    expect(shared).toEqual([[reliable[0].phone, 2]]);
    expect(reliable[1].phone).toBe(reliable[0].phone);
  });

  it("exactly the four national-chain names match a default chain pattern", () => {
    const chains = ALL.filter((b) => matchesChainPattern(b.name)).map((b) => b.name);
    expect(chains.sort()).toEqual([
      "Aspen Dental - South Lamar",
      "Mr. Rooter Plumbing of Houston",
      "One Hour Heating & Air Conditioning of Dallas",
      "Roto-Rooter Plumbing & Water Cleanup",
    ]);
  });

  it("detail overrides exist for exactly six ids, all present in the sets", () => {
    const ids = new Set(ALL.map((b) => b.id));
    const detailIds = Object.keys(TRAP_DETAILS);
    expect(detailIds).toHaveLength(6);
    for (const id of detailIds) expect(ids.has(id), id).toBe(true);
    expect(Object.values(TRAP_DETAILS).filter((d) => d.is_claimed === false)).toHaveLength(2);
  });
});
