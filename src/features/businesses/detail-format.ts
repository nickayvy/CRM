// Formatting helpers for the business detail page (pure; server-safe).
import { formatInTimeZone } from "date-fns-tz";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type YelpOpen = { day: number; start: string; end: string; is_overnight?: boolean };
type YelpHours = { open?: YelpOpen[]; hours_type?: string; is_open_now?: boolean };

function hhmm(s: string): string {
  const h = Number(s.slice(0, 2));
  const m = s.slice(2, 4);
  if (!Number.isFinite(h)) return s;
  const suffix = h >= 12 && h < 24 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** Yelp `hours` jsonb → seven rows Monday..Sunday ("Closed" when no interval). Null when no regular hours. */
export function hoursRows(hours: unknown): { day: string; text: string }[] | null {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const regular = (hours as YelpHours[]).find((h) => !h.hours_type || h.hours_type === "REGULAR") ?? (hours[0] as YelpHours);
  const open = Array.isArray(regular?.open) ? regular.open : [];
  if (open.length === 0) return null;
  return DAYS.map((day, i) => {
    const slots = open.filter((o) => o.day === i);
    return {
      day,
      text: slots.length
        ? slots.map((o) => `${hhmm(o.start)} – ${hhmm(o.end)}${o.is_overnight ? " (next day)" : ""}`).join(", ")
        : "Closed",
    };
  });
}

export function isOpenNow(hours: unknown): boolean | null {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const v = (hours[0] as YelpHours).is_open_now;
  return typeof v === "boolean" ? v : null;
}

export function mapsUrl(lat: number | null, lng: number | null, address?: string): string | null {
  if (lat !== null && lng !== null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return null;
}

/** Date → `datetime-local` value in the given zone ("2026-11-10T09:30"), or "". */
export function toDateTimeLocal(d: Date | string | null, tz: string): string {
  if (!d) return "";
  return formatInTimeZone(d instanceof Date ? d : new Date(d), tz, "yyyy-MM-dd'T'HH:mm");
}

const TRANSACTION_LABELS: Record<string, string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  restaurant_reservation: "Reservations",
};

export function transactionLabel(t: string): string {
  return TRANSACTION_LABELS[t] ?? t.replace(/_/g, " ");
}
