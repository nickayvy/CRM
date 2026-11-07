import path from "node:path";
import type { NextConfig } from "next";

// The directory holding this file. Pinned explicitly so Turbopack does not
// pick a parent directory (e.g. the main checkout when this is a git
// worktree) as the root and watch sibling worktrees.
const projectRoot = path.resolve(import.meta.dirname ?? process.cwd());

// cacheComponents is intentionally left off: the architecture requires
// `export const dynamic = 'force-dynamic'` on every DB-reading page, a route
// segment config that Cache Components does not accept.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  outputFileTracingRoot: projectRoot,
  // Yelp fixtures are read with fs at runtime (fixture mode, no YELP_API_KEY).
  // Any route or server action can start a search, so ship them with every
  // server function.
  outputFileTracingIncludes: {
    "/**": ["./fixtures/yelp/**/*.json"],
  },
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
