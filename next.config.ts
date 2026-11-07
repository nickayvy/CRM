import type { NextConfig } from "next";

// cacheComponents is intentionally left off: the architecture requires
// `export const dynamic = 'force-dynamic'` on every DB-reading page, a route
// segment config that Cache Components does not accept.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
