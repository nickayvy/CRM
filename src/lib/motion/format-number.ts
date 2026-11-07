/**
 * Number formats shared by `AnimatedNumber` and `StatCard`.
 *
 * Presets and `Intl.NumberFormatOptions` objects are serializable, so they can
 * be passed from Server Components into client components. A function format
 * only works when the caller is itself a client component.
 */
export type NumberFormatPreset =
  /** 1,234 */
  | "integer"
  /** 1,234.5 (one decimal) */
  | "decimal"
  /** value is a fraction: 0.423 → 42% */
  | "percent"
  /** USD, whole dollars: $12,400 */
  | "currency"
  /** 12.4K, 1.2M */
  | "compact";

export type NumberFormat = NumberFormatPreset | Intl.NumberFormatOptions | ((value: number) => string);

const PRESETS: Record<NumberFormatPreset, Intl.NumberFormatOptions> = {
  integer: { maximumFractionDigits: 0 },
  decimal: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  percent: { style: "percent", maximumFractionDigits: 0 },
  currency: { style: "currency", currency: "USD", maximumFractionDigits: 0 },
  compact: { notation: "compact", maximumFractionDigits: 1 },
};

const cache = new Map<string, Intl.NumberFormat>();

function intlFor(options: Intl.NumberFormatOptions, locale: string): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/** Returns a `(n) => string` for any `NumberFormat`. Default format is `"integer"`; default locale `en-US`. */
export function getNumberFormatter(format: NumberFormat = "integer", locale = "en-US"): (value: number) => string {
  if (typeof format === "function") return format;
  const options = typeof format === "string" ? PRESETS[format] : format;
  const intl = intlFor(options, locale);
  return (value: number) => intl.format(value);
}

/** Formats `value` with a `NumberFormat`. */
export function formatNumber(value: number, format: NumberFormat = "integer", locale = "en-US"): string {
  return getNumberFormatter(format, locale)(value);
}
