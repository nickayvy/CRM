// Typed, validated view of process.env. Read lazily per access so tests and
// scripts can set variables before first use.

const DEV_SESSION_SECRET = "dev-insecure-session-secret-change-me";

function str(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

let warnedSecret = false;

export type Env = {
  DATABASE_URL?: string;
  PGLITE_DATA_DIR: string;
  YELP_API_KEY?: string;
  YELP_MODE: "live" | "fixture";
  APP_PASSWORD?: string;
  APP_SESSION_SECRET: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
  CRON_SECRET?: string;
  APP_TIMEZONE: string;
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
  get YELP_MODE() {
    const explicit = str("YELP_MODE");
    if (explicit === "live" || explicit === "fixture") return explicit;
    return str("YELP_API_KEY") ? "live" : "fixture";
  },
  get APP_PASSWORD() {
    return str("APP_PASSWORD");
  },
  get APP_SESSION_SECRET() {
    const v = str("APP_SESSION_SECRET");
    if (v) return v;
    if (!warnedSecret && str("APP_PASSWORD")) {
      warnedSecret = true;
      console.warn(
        "[env] APP_SESSION_SECRET is not set; using an insecure development default. Set it in production.",
      );
    }
    return DEV_SESSION_SECRET;
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
};
