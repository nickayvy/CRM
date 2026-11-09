// Typed, validated view of process.env. Read lazily per access so tests and
// scripts can set variables before first use.
//
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are read literally in
// src/lib/supabase/config.ts (Next.js inlines NEXT_PUBLIC_* only on literal reads).

function str(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

export type Env = {
  DATABASE_URL?: string;
  PGLITE_DATA_DIR: string;
  /** Absent → Yelp search is disabled. */
  YELP_API_KEY?: string;
  /** Absent → Trustpilot discovery is disabled. */
  FIRECRAWL_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
  CRON_SECRET?: string;
  APP_TIMEZONE: string;
  /** Public base URL of the deployment (absolute links, auth redirects). */
  NEXT_PUBLIC_APP_URL?: string;
};

export const env: Env = {
  get DATABASE_URL() {
    return str("DATABASE_URL");
  },
  get PGLITE_DATA_DIR() {
    return str("PGLITE_DATA_DIR") ?? ".data/pglite";
  },
  get YELP_API_KEY() {
    return str("YELP_API_KEY");
  },
  get FIRECRAWL_API_KEY() {
    return str("FIRECRAWL_API_KEY");
  },
  get RESEND_API_KEY() {
    return str("RESEND_API_KEY");
  },
  get EMAIL_FROM() {
    return str("EMAIL_FROM") ?? "CRM <onboarding@resend.dev>";
  },
  get CRON_SECRET() {
    return str("CRON_SECRET");
  },
  get APP_TIMEZONE() {
    return str("APP_TIMEZONE") ?? "America/Chicago";
  },
  get NEXT_PUBLIC_APP_URL() {
    return str("NEXT_PUBLIC_APP_URL");
  },
};
