import { formatInTimeZone } from "date-fns-tz";

const DEFAULT_TZ = "America/Chicago";

function defaultTimezone(): string {
  // Read directly (not via env.ts) so this module stays safe in client bundles.
  const tz = typeof process !== "undefined" ? process.env.APP_TIMEZONE : undefined;
  return tz && tz.trim() ? tz.trim() : DEFAULT_TZ;
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** "+17135550123" → "(713) 555-0123". Null/empty → "". Non-NANP numbers are returned unchanged. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const digits = e164.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return e164;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** 4.5 | "4.5" → "4.5"; 4 → "4.0"; null/invalid → "—". */
export function formatRating(r: number | string | null): string {
  if (r === null || r === "") return "—";
  const n = typeof r === "number" ? r : Number(r);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

/** Short relative time: "just now", "5 min ago", "3 h ago", "2 d ago", "in 3 h"; older than 30 d → formatDate. */
export function formatRelative(d: Date | string, now: Date = new Date()): string {
  const date = toDate(d);
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const min = Math.floor(abs / 60_000);
  if (min < 1) return "just now";
  let text: string;
  if (min < 60) text = `${min} min`;
  else if (min < 60 * 24) text = `${Math.floor(min / 60)} h`;
  else if (min < 60 * 24 * 30) text = `${Math.floor(min / (60 * 24))} d`;
  else return formatDate(date);
  return future ? `in ${text}` : `${text} ago`;
}

/** "Nov 7, 2026, 2:05 PM" in the given IANA zone (default APP_TIMEZONE). */
export function formatDate(d: Date | string, tz?: string): string {
  return formatInTimeZone(toDate(d), tz ?? defaultTimezone(), "MMM d, yyyy, h:mm a");
}

const LEGAL_SUFFIXES = new Set(["llc", "inc", "co", "corp", "ltd"]);

/**
 * Lowercase, strip punctuation, drop trailing legal suffixes (llc, inc, co,
 * corp, ltd), collapse whitespace. "Reliable Plumbing Co." → "reliable plumbing".
 */
export function normalizeName(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Digits only, for duplicate detection. "+1 (713) 555-0123" → "17135550123"; null/"" → null. */
export function phoneDigits(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
