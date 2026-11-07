import { afterEach, describe, expect, it, vi } from "vitest";
import { createDbFromEnv, driverOf } from "@/db/client";
import { MIGRATIONS_FOLDER } from "@/db/migrate";
import { createTestDb } from "@/db/test-utils";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("db client driver selection", () => {
  it("uses postgres-js when DATABASE_URL is set (no connection is opened until a query runs)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/none");
    const handle = createDbFromEnv();
    expect(handle.driver).toBe("postgres");
    expect(driverOf(handle.db)).toBe("postgres");
    await handle.close();
  });

  it("uses PGlite for test databases", async () => {
    const { db, close } = await createTestDb();
    expect(driverOf(db)).toBe("pglite");
    await close();
  });

  it("both drivers migrate from the same ./drizzle folder", () => {
    expect(MIGRATIONS_FOLDER.endsWith("/drizzle")).toBe(true);
  });
});
