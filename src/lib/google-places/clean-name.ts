// Deterministic business-name cleaning for Google listings (spec R9):
// "BEST ROOFING DALLAS TX - Free Estimates" → "Best Roofing". Pure; safe in
// client bundles. The uncleaned name stays in the row's `raw`.

const SEPARATORS = /\s+[-–—|•·:~]+\s+|\s*[|•·]\s*|\s*:\s+/;

/** Phrases that are marketing, not part of a name. Matched against a whole segment or a trailing clause. */
const TAGLINE_RE = new RegExp(
  [
    String.raw`free\s+(estimates?|quotes?|inspections?|consultations?)`,
    String.raw`24\s*/\s*7`,
    String.raw`24\s*hours?`,
    String.raw`open\s+24\s*hours?`,
    String.raw`emergency(\s+(service|services|repair|repairs))?`,
    String.raw`same[\s-]+day(\s+service)?`,
    String.raw`licensed(\s*(&|and)\s*(insured|bonded))*`,
    String.raw`(bonded\s*(&|and)\s*)?insured`,
    String.raw`(family|locally|veteran|woman|women)[\s-]+owned(\s*(&|and)\s*operated)?`,
    String.raw`top[\s-]+rated`,
    String.raw`best\s+in\s+town`,
    String.raw`near\s+me`,
    String.raw`call\s+(now|today|us)`,
    String.raw`serving\s+.+`,
    String.raw`since\s+\d{4}`,
    String.raw`#\s*1(\s+.+)?`,
    String.raw`residential(\s*(&|and|/)\s*commercial)?`,
    String.raw`commercial(\s*(&|and|/)\s*residential)?`,
    String.raw`affordable\s+.+`,
    String.raw`(repair|replacement|installation)s?(\s*(&|and|,)\s*(repair|replacement|installation)s?)+`,
    String.raw`(we|now)\s+.+`,
  ]
    .map((p) => `(?:${p})`)
    .join("|"),
  "i",
);
const isTagline = (s: string) => new RegExp(`^(?:${TAGLINE_RE.source})[.!]*$`, "i").test(s.trim());

const STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);
/** State codes that are also common words or name suffixes: stripped only when they are the listing's own state. */
const AMBIGUOUS_STATES = new Set(["CO", "IN", "OR", "ME", "OK", "HI", "PA", "MD", "DE", "LA", "MA", "ID", "AL"]);
const STATE_NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  PR: "puerto rico", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas",
  UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

/**
 * Words that end a business name ("… Roofing", "… Dental", "… LLC"). When a
 * trailing state code is removed, the words before it are dropped as a city
 * only up to one of these, so "Best Roofing San Antonio TX" → "Best Roofing"
 * but "Smith & Sons TX" keeps "Smith & Sons".
 */
const NAME_END_WORDS = new Set(
  (
    "roofing roofers roofer plumbing plumber plumbers electric electrical electrician electricians hvac air heating cooling " +
    "landscaping landscape lawn pest control cleaning cleaners maids painting painters locksmith locksmiths movers moving " +
    "construction contractors contractor contracting builders remodeling restoration services service solutions company co " +
    "llc inc ltd corp pllc pc pa group partners associates sons brothers bros enterprises dental dentistry dentist orthodontics " +
    "chiropractic chiropractor clinic center centre spa salon barbershop barber studio studios fitness gym yoga pilates " +
    "karate academy dojo law lawyers attorneys firm accounting cpa cpas tax insurance realty properties homes " +
    "auto automotive repair motors garage collision veterinary vet hospital animal pets bakery cafe coffee restaurant " +
    "grill kitchen bar pizza tacos bbq diner eatery"
  ).split(/\s+/),
);

/** Upper-case tokens kept as-is when fixing case. */
const ACRONYMS = new Set(
  (
    "HVAC LLC LLP PLLC INC PC PA DDS DMD MD DO DC DVM CPA CPAS USA US BBQ AC A/C TV AV RV ATM DBA II III IV VI " +
    "ABC AAA AA DFW ATX NYC LA SF KC STL OKC DIY HQ PT MMA BJJ ER UV"
  ).split(/\s+/),
);
/** Short words that are ordinary words, title-cased when fixing case (other words of ≤ 3 letters are kept upper-case). */
const SHORT_WORDS = new Set(
  (
    "a an the and of in at by for to on or our my your all top one two big red sun pro bay oak ace new old air car pet " +
    "spa bar dry fix fun joe bob dan tom sam max key way ten son mom pop hot ice sky zen art cut dog cat fit gym ink law " +
    "tax med vet eye hub lab tree yard home city best blue gold star true fast west east north south mr mrs dr st mt ft co inc ltd"
  ).split(/\s+/),
);
const LOWER_WORDS = new Set(["a", "an", "the", "and", "of", "in", "at", "by", "for", "to", "on", "or"]);

function letters(s: string): string {
  return s.replace(/[^A-Za-z]/g, "");
}

/** Shouting (mostly upper case) or all lower case → title case, keeping acronyms. Mixed case is left alone. */
function fixCase(name: string): string {
  const l = letters(name);
  if (l.length < 2) return name;
  const upper = l.replace(/[^A-Z]/g, "").length / l.length;
  const shouting = upper >= 0.8;
  const lower = upper === 0;
  if (!shouting && !lower) return name;
  const words = name.split(/(\s+)/);
  let index = 0;
  return words
    .map((w) => {
      if (/^\s+$/.test(w) || !/[A-Za-z]/.test(w)) return w;
      const first = index++ === 0;
      return w
        .split("-")
        .map((part) => casePart(part, first, shouting))
        .join("-");
    })
    .join("");
}

function casePart(part: string, first: boolean, shouting: boolean): string {
  const bare = part.replace(/[^A-Za-z/]/g, "");
  const up = bare.toUpperCase();
  if (shouting && ACRONYMS.has(up)) return part;
  if (!shouting && bare.length >= 3 && ACRONYMS.has(up)) return part.toUpperCase(); // "dfw" → "DFW"
  if (shouting && bare.length > 0 && bare.length <= 3 && !SHORT_WORDS.has(bare.toLowerCase()) && !/[a-z]/.test(part))
    return part; // "ABC", "JRB", "A1"
  const lower = part.toLowerCase();
  if (!first && LOWER_WORDS.has(lower)) return lower;
  // Title case: first letter of the word and after an apostrophe-free boundary ("o'neil" → "O'Neil", "joe's" → "Joe's").
  let out = lower.replace(/^([^a-z]*)([a-z])/, (_m, pre: string, c: string) => pre + c.toUpperCase());
  out = out.replace(/^(o')([a-z])/i, (_m, pre: string, c: string) => "O'" + c.toUpperCase());
  out = out.replace(/^(mc)([a-z])/i, (_m, _pre: string, c: string) => "Mc" + c.toUpperCase());
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drops a trailing ", Free Estimates" style clause, repeatedly. */
function stripTrailingTaglines(s: string): string {
  let out = s.trim();
  for (;;) {
    // The trailing comma clause first, then trailing words that form a tagline.
    const comma = out.lastIndexOf(",");
    if (comma > 0 && isTagline(out.slice(comma + 1))) {
      out = out.slice(0, comma).trim();
      continue;
    }
    const words = out.split(/\s+/);
    let cut = -1;
    for (let i = 1; i < words.length; i++) {
      if (isTagline(words.slice(i).join(" "))) {
        cut = i;
        break;
      }
    }
    if (cut > 0) {
      out = words.slice(0, cut).join(" ").replace(/[\s,&-]+$/, "").trim();
      continue;
    }
    return out;
  }
}

/** Removes a trailing "<city> <ST>", "<city>, <ST>", "of/in <city>" or bare state. */
function stripLocation(s: string, ctx: { city?: string | null; state?: string | null }): string {
  let out = s.trim();
  const ctxState = ctx.state?.trim().toUpperCase() || null;
  let removedState = false;

  // Trailing state code (upper case in the original) or the listing's own state name.
  const stateM = /[\s,]+([A-Za-z]{2})\.?$/.exec(out);
  if (stateM) {
    const code = stateM[1];
    const isUpper = code === code.toUpperCase();
    const known = STATE_CODES.has(code.toUpperCase());
    const ambiguous = AMBIGUOUS_STATES.has(code.toUpperCase());
    if (known && isUpper && (!ambiguous || code.toUpperCase() === ctxState)) {
      out = out.slice(0, stateM.index).trim();
      removedState = true;
    }
  }
  if (!removedState && ctxState && STATE_NAMES[ctxState]) {
    const re = new RegExp(`[\\s,]+${escapeRe(STATE_NAMES[ctxState])}$`, "i");
    if (re.test(out)) {
      out = out.replace(re, "").trim();
      removedState = true;
    }
  }
  out = out.replace(/[\s,]+$/, "");

  // The listing's own city, with an optional "of"/"in" before it.
  const city = ctx.city?.trim();
  if (city) {
    const re = new RegExp(`(?:[\\s,]+(?:of|in))?[\\s,]+${escapeRe(city)}$`, "i");
    if (re.test(out)) return out.replace(re, "").trim();
  }

  // Without a known city: after a removed state code, drop up to three words back to a name-ending word.
  if (removedState) {
    const words = out.split(/\s+/);
    for (let k = 1; k <= 3 && k < words.length; k++) {
      const before = words[words.length - k - 1].toLowerCase().replace(/[^a-z]/g, "");
      if (NAME_END_WORDS.has(before)) {
        const kept = words.slice(0, words.length - k);
        if (/^(of|in)$/i.test(kept[kept.length - 1] ?? "")) kept.pop();
        return kept.join(" ").replace(/[\s,]+$/, "");
      }
    }
  }
  return out;
}

function meaningful(s: string, ctx: { city?: string | null; state?: string | null }): boolean {
  const t = s.trim().replace(/^[\s,&-]+|[\s,&-]+$/g, "");
  if (!t || !/[A-Za-z0-9]/.test(t)) return false;
  if (isTagline(t)) return false;
  const lower = t.toLowerCase();
  if (ctx.city && lower === ctx.city.trim().toLowerCase()) return false;
  if (STATE_CODES.has(t.toUpperCase()) && t.length === 2) return false;
  return true;
}

/**
 * Cleans a listing name: drops taglines after a separator ("-", "|", "–", …)
 * or as a trailing clause, drops a tacked-on city/state, and fixes shouting
 * (keeping acronyms such as "HVAC" and legal suffixes such as "LLC"). A name
 * that is only a location or a tagline falls back to the raw name. Never
 * returns an empty string.
 */
export function cleanBusinessName(raw: string, ctx: { city?: string | null; state?: string | null } = {}): string {
  const original = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!original) return "Unnamed business";

  // 1. Separator taglines: keep the first segment that is a name.
  const segments = original.split(SEPARATORS).map((x) => x.trim()).filter(Boolean);
  let name = segments.find((seg) => meaningful(stripLocation(stripTrailingTaglines(seg), ctx), ctx)) ?? "";
  if (!name) return original;

  // 2. Trailing tagline clauses and location.
  name = stripTrailingTaglines(name);
  name = stripLocation(name, ctx);
  name = name.replace(/^[\s,&-]+|[\s,&-]+$/g, "").trim();
  if (!meaningful(name, ctx)) return original;

  // 3. Case.
  return fixCase(name);
}
