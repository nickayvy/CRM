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
  /** Firecrawl request starts allowed per rolling 60 s (plan limit); default 10, minimum 1. */
  FIRECRAWL_REQUESTS_PER_MINUTE: number;
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
  CRON_SECRET?: string;
  APP_TIMEZONE: string;
  /** ElevenLabs Agents (AI calling). All four set → AI campaigns can place calls. */
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  /** ElevenLabs id of the imported Twilio number (not the phone number itself). */
  ELEVENLABS_PHONE_NUMBER_ID?: string;
  /** Signing secret of the workspace post-call webhook. */
  ELEVENLABS_WEBHOOK_SECRET?: string;
  /** Public base URL of the deployment (absolute links, auth redirects). */
  NEXT_PUBLIC_APP_URL?: string;
  /** Absent → Google Maps search is disabled. */
  GOOGLE_PLACES_API_KEY?: string;
  /** Geocoding API key for areas the offline zip data cannot resolve; falls back to GOOGLE_PLACES_API_KEY. */
  GOOGLE_GEOCODING_API_KEY?: string;
  /** Google Places requests allowed per calendar month (UTC); default 1000, minimum 0. */
  GOOGLE_PLACES_MONTHLY_REQUEST_CAP: number;
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
  get FIRECRAWL_REQUESTS_PER_MINUTE() {
    const n = Number(str("FIRECRAWL_REQUESTS_PER_MINUTE") ?? 10);
    return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 10;
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
  get ELEVENLABS_API_KEY() {
    return str("ELEVENLABS_API_KEY");
  },
  get ELEVENLABS_AGENT_ID() {
    return str("ELEVENLABS_AGENT_ID");
  },
  get ELEVENLABS_PHONE_NUMBER_ID() {
    return str("ELEVENLABS_PHONE_NUMBER_ID");
  },
  get ELEVENLABS_WEBHOOK_SECRET() {
    return str("ELEVENLABS_WEBHOOK_SECRET");
  },
  get NEXT_PUBLIC_APP_URL() {
    return str("NEXT_PUBLIC_APP_URL");
  },
  get GOOGLE_PLACES_API_KEY() {
    return str("GOOGLE_PLACES_API_KEY");
  },
  get GOOGLE_GEOCODING_API_KEY() {
    return str("GOOGLE_GEOCODING_API_KEY") ?? str("GOOGLE_PLACES_API_KEY");
  },
  get GOOGLE_PLACES_MONTHLY_REQUEST_CAP() {
    const n = Number(str("GOOGLE_PLACES_MONTHLY_REQUEST_CAP") ?? 1000);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1000;
  },
};
