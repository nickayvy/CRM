// Pure timezone helpers for calling campaigns. No server imports: the dialer
// uses these in the browser too.
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "9:00" | "09:00" | "09:00:00" → "09:00:00"; anything else → null. */
export function normalizeTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (h > 23 || min > 59 || s > 59) return null;
  return [h, min, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** "09:00:00" → "09:00" (for `<input type="time">` and display). */
export function shortTime(t: string | null | undefined): string {
  const n = normalizeTime(t);
  return n ? n.slice(0, 5) : "";
}

/** Local calendar day of `d` in `tz`, as "yyyy-MM-dd". */
export function localDay(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}

/** UTC instants bounding the local calendar day of `now` in `tz`: [start, end). */
export function localDayBounds(now: Date, tz: string): { start: Date; end: Date } {
  const day = localDay(now, tz);
  const start = fromZonedTime(`${day}T00:00:00`, tz);
  // Next local midnight: format the day after (handles 23/25-hour DST days).
  const nextDay = formatInTimeZone(addDays(fromZonedTime(`${day}T12:00:00`, tz), 1), tz, "yyyy-MM-dd");
  const end = fromZonedTime(`${nextDay}T00:00:00`, tz);
  return { start, end };
}

/**
 * Whether the local time of `now` in `tz` is inside [start, end). Both null →
 * always true. A window whose end is before its start wraps past midnight
 * (e.g. 22:00–02:00).
 */
export function isWithinHours(now: Date, tz: string, start: string | null, end: string | null): boolean {
  const s = normalizeTime(start);
  const e = normalizeTime(end);
  if (!s || !e) return true;
  const t = formatInTimeZone(now, tz, "HH:mm:ss");
  if (s === e) return true;
  if (s < e) return t >= s && t < e;
  return t >= s || t < e;
}

/** "yyyy-MM-ddTHH:mm" (datetime-local) interpreted as wall time in `tz` → UTC Date; invalid → null. */
export function parseLocalDateTime(value: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const d = fromZonedTime(value.length === 16 ? `${value}:00` : value, tz);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC Date → "yyyy-MM-ddTHH:mm" wall time in `tz` (datetime-local value). */
export function toLocalDateTimeValue(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm");
}

/** Default callback time: tomorrow 10:00 in `tz`, as a datetime-local value. */
export function defaultCallbackValue(now: Date, tz: string): string {
  const tomorrow = formatInTimeZone(addDays(fromZonedTime(`${localDay(now, tz)}T12:00:00`, tz), 1), tz, "yyyy-MM-dd");
  return `${tomorrow}T10:00`;
}
