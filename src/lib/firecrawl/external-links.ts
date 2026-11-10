// Pure extraction of a business's external links (website, social profiles,
// email, phone) from a non-LLM page scrape. No I/O. Validation rules:
// docs/team/links/architecture.md §Validation rules (R7).
import type { ScrapedPage } from "./client";

export const SOCIAL_KEYS = ["facebook", "twitter", "linkedin", "instagram", "youtube", "tiktok"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export type ExternalLinks = {
  /** Clean origin-level website (https://host[/path]); null when unknown. */
  website: string | null;
  socialLinks: Partial<Record<SocialKey, string>>;
  email: string | null;
  phone: string | null;
};

/** Same-host contact/about/support page worth a second look, if any. */
export type Extracted = ExternalLinks & { contactUrl: string | null };

// ------------------------------------------------------------ website

/**
 * A domain-like slug ("acme.com", "www.acme.co.uk"). Written so the same
 * pattern works as a JS RegExp and as a Postgres `~` regex (lowercase input).
 */
export const DOMAIN_SLUG_PATTERN = "^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+([a-z]{2,}|xn--[a-z0-9-]+)$";
const DOMAIN_SLUG_RE = new RegExp(DOMAIN_SLUG_PATTERN);

/** Query parameters that only track the click. */
const TRACKING_PARAM_RE = /^(utm_.*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

/** True for a slug that names a domain ("acme.com"); false for "acme" or "acme com". */
export function isDomainSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && DOMAIN_SLUG_RE.test(slug.trim().toLowerCase());
}

/** `acme.com` → `https://acme.com`; null for a slug that is not domain-like. */
export function websiteFromSlug(slug: string | null | undefined): string | null {
  if (!isDomainSlug(slug)) return null;
  return `https://${slug!.trim().toLowerCase()}`;
}

function parseHttpUrl(raw: string, base?: string): URL | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  return u;
}

/**
 * Cleans a stored or scraped website URL: drops `utm_*` and click-id
 * parameters, the fragment and any credentials; lowercases the host; removes a
 * bare trailing slash. A scheme-less domain ("www.acme.com/x") gets `https://`.
 * Any other scheme (`ftp:`, `javascript:`, `mailto:`) or a non-URL → null.
 */
export function cleanWebsiteUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  let raw = url.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    // Scheme-less: only accept something that starts with a domain.
    const host = raw.split(/[/?#]/)[0].toLowerCase();
    if (!isDomainSlug(host)) return null;
    raw = `https://${raw}`;
  }
  const u = parseHttpUrl(raw);
  if (!u || !u.hostname.includes(".")) return null;
  u.username = "";
  u.password = "";
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM_RE.test(key)) u.searchParams.delete(key);
  }
  let out = u.toString();
  if (u.pathname === "/" && !u.search) out = out.replace(/\/$/, "");
  return out;
}

/** `https://www.acme.com/x?y` → `https://www.acme.com`. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = parseHttpUrl(url.trim());
  return u && u.hostname.includes(".") ? `${u.protocol}//${u.host.toLowerCase()}` : null;
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

// ------------------------------------------------------------ social profiles

/** True when `host` is `domain` or a subdomain of it (never a look-alike). */
function onDomain(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

const segments = (u: URL) =>
  u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

/** A candidate profile URL with a rank (lower wins; ties keep page order). */
type Candidate = { key: SocialKey; url: string; rank: number };

const FACEBOOK_REJECT = new Set([
  "sharer", "sharer.php", "share", "share.php", "dialog", "plugins", "login", "login.php", "logout.php", "l.php",
  "tr", "policies", "policy", "privacy", "help", "legal", "terms", "ads", "business", "watch", "events", "hashtag",
  "photo", "photo.php", "photos", "story.php", "permalink.php", "media", "settings", "recover", "home.php", "v2.0",
  "v2.1", "v2.2", "v2.3", "v2.4", "v2.5", "v2.6", "v2.7", "v2.8", "v2.9", "v3.0",
]);
const TWITTER_RESERVED = new Set([
  "intent", "share", "home", "search", "hashtag", "i", "login", "signup", "privacy", "tos", "settings", "explore",
  "notifications", "messages", "compose", "widgets", "about", "download", "account", "logout",
]);
const INSTAGRAM_RESERVED = new Set([
  "p", "reel", "reels", "explore", "accounts", "stories", "tv", "direct", "legal", "about", "developer", "web",
]);
const LINKEDIN_KINDS: Record<string, number> = { company: 0, showcase: 1, school: 1, in: 2 };

function facebook(u: URL): Candidate | null {
  if (!onDomain(u.hostname, ["facebook.com", "fb.com"])) return null;
  const segs = segments(u);
  if (segs.length === 0 || FACEBOOK_REJECT.has(segs[0].toLowerCase())) return null;
  if (segs[0].toLowerCase() === "profile.php") {
    const id = u.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return null;
    return { key: "facebook", url: `https://${u.hostname.toLowerCase()}/profile.php?id=${id}`, rank: 0 };
  }
  if (segs[0].toLowerCase() === "people" || segs[0].toLowerCase() === "pages") {
    if (segs.length < 2) return null;
  }
  return { key: "facebook", url: `https://${u.hostname.toLowerCase()}/${segs.map(encodeURIComponent).join("/")}`, rank: 0 };
}

function twitter(u: URL): Candidate | null {
  if (!onDomain(u.hostname, ["twitter.com", "x.com"])) return null;
  const handle = segments(u)[0];
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || TWITTER_RESERVED.has(handle.toLowerCase())) return null;
  return { key: "twitter", url: `https://${u.hostname.toLowerCase()}/${handle}`, rank: 0 };
}

function linkedin(u: URL): Candidate | null {
  if (!onDomain(u.hostname, ["linkedin.com"])) return null;
  const [kind, name] = segments(u);
  if (!kind || !name) return null;
  const rank = LINKEDIN_KINDS[kind.toLowerCase()];
  if (rank === undefined) return null;
  return { key: "linkedin", url: `https://${u.hostname.toLowerCase()}/${kind.toLowerCase()}/${encodeURIComponent(name)}`, rank };
}

function instagram(u: URL): Candidate | null {
  if (!onDomain(u.hostname, ["instagram.com"])) return null;
  const handle = segments(u)[0];
  if (!handle || !/^[A-Za-z0-9._]{1,30}$/.test(handle) || INSTAGRAM_RESERVED.has(handle.toLowerCase())) return null;
  return { key: "instagram", url: `https://${u.hostname.toLowerCase()}/${handle}`, rank: 0 };
}

function youtube(u: URL): Candidate | null {
  const host = u.hostname.toLowerCase();
  const segs = segments(u);
  if (onDomain(host, ["youtu.be"])) {
    // A video short link: the business's own video, kept only when no channel URL exists.
    return segs[0] && /^[A-Za-z0-9_-]{6,}$/.test(segs[0]) ? { key: "youtube", url: `https://${host}/${segs[0]}`, rank: 1 } : null;
  }
  if (!onDomain(host, ["youtube.com"])) return null;
  const [first, second] = segs;
  if (!first) return null;
  if (first.startsWith("@") && /^@[A-Za-z0-9._-]{1,100}$/.test(first)) return { key: "youtube", url: `https://${host}/${first}`, rank: 0 };
  if (["channel", "c", "user"].includes(first.toLowerCase()) && second && /^[A-Za-z0-9._-]+$/.test(second)) {
    return { key: "youtube", url: `https://${host}/${first.toLowerCase()}/${second}`, rank: 0 };
  }
  return null;
}

function tiktok(u: URL): Candidate | null {
  if (!onDomain(u.hostname, ["tiktok.com"])) return null;
  const handle = segments(u)[0];
  if (!handle || !/^@[A-Za-z0-9._]{2,24}$/.test(handle)) return null;
  return { key: "tiktok", url: `https://${u.hostname.toLowerCase()}/${handle}`, rank: 0 };
}

const PLATFORMS = [facebook, twitter, linkedin, instagram, youtube, tiktok];

/**
 * Classifies one URL as a social profile: http(s) only, the platform's own
 * host (or a subdomain), a non-empty profile path, never a share/intent/login/
 * policy URL. Returns the normalized `https://` URL (query and fragment
 * dropped, except Facebook's `profile.php?id=`), or null.
 */
export function socialProfile(raw: string | null | undefined): { key: SocialKey; url: string } | null {
  const c = candidate(raw);
  return c ? { key: c.key, url: c.url } : null;
}

function candidate(raw: string | null | undefined): Candidate | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const u = parseHttpUrl(raw.trim());
  if (!u) return null;
  for (const platform of PLATFORMS) {
    const c = platform(u);
    if (c) return c;
  }
  return null;
}

/** Picks one profile per platform: lowest rank wins, then the first on the page. */
function pickSocial(urls: readonly string[]): Partial<Record<SocialKey, string>> {
  const best = new Map<SocialKey, Candidate>();
  for (const raw of urls) {
    const c = candidate(raw);
    if (!c) continue;
    const prev = best.get(c.key);
    if (!prev || c.rank < prev.rank) best.set(c.key, c);
  }
  const out: Partial<Record<SocialKey, string>> = {};
  for (const key of SOCIAL_KEYS) {
    const c = best.get(key);
    if (c) out[key] = c.url;
  }
  return out;
}

// ------------------------------------------------------------ email and phone

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const EMAIL_IN_TEXT_RE = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/g;
/** "logo@2x.png" and friends: an asset name, not an address. */
const ASSET_TLD_RE = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|css|js|mjs|json|mp4|webm|mov|woff2?|ttf|otf|eot|pdf)$/;
const PLACEHOLDER_DOMAINS = [
  "example.com", "example.org", "example.net", "domain.com", "email.com", "yourdomain.com", "yoursite.com",
  "yourcompany.com", "company.com", "website.com", "test.com", "sentry.io", "wixpress.com", "sentry-next.wixpress.com",
];
const PLACEHOLDER_LOCALS = new Set([
  "you", "your", "yourname", "your.name", "name", "email", "user", "username", "john.doe", "jane.doe", "johndoe",
  "janedoe", "john", "test", "noreply", "no-reply", "donotreply", "do-not-reply", "example",
]);

/** A plausible contact address, lowercased; null for asset names, placeholders and junk. */
export function cleanEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^mailto:/i, "").split("?")[0];
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  s = s.trim().toLowerCase();
  if (!EMAIL_RE.test(s) || ASSET_TLD_RE.test(s)) return null;
  const [local, domain] = s.split("@");
  if (PLACEHOLDER_LOCALS.has(local)) return null;
  if (PLACEHOLDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return null;
  if (/sentry/.test(domain)) return null;
  // Hashes (tracking ids such as "5f2b…@sentry") are not inboxes.
  if (/^[0-9a-f]{16,}$/.test(local)) return null;
  return s;
}

/** A `tel:` href → the number as written ("+1-800-555-0100"); null unless it has 7–15 digits. */
export function phoneFromTel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !/^tel:/i.test(raw.trim())) return null;
  let s = raw.trim().slice(4).split(/[?;]/)[0];
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  s = s.replace(/[^\d+()\-. ]/g, "").trim();
  const digits = s.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15 ? s : null;
}

/** Prefers an address on the site's own domain, then the first one found. */
function pickEmail(candidates: string[], siteHost: string | null): string | null {
  const valid = candidates.map(cleanEmail).filter((e): e is string => !!e);
  if (valid.length === 0) return null;
  if (siteHost) {
    const own = valid.find((e) => {
      const d = e.split("@")[1];
      return d === siteHost || d.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${d}`);
    });
    if (own) return own;
  }
  return valid[0];
}

// ------------------------------------------------------------ contact page

const CONTACT_PATHS: [RegExp, number][] = [
  [/contact|kontakt|get-in-touch/i, 0],
  [/support|customer-service|customer-care|help/i, 1],
  [/about/i, 2],
];

function pickContactUrl(links: readonly string[], base: string, siteHost: string | null): string | null {
  if (!siteHost) return null;
  const self = new URL(base);
  let best: { url: string; rank: number } | null = null;
  for (const raw of links) {
    const u = parseHttpUrl(raw.trim(), base);
    if (!u || bareHost(u.hostname) !== siteHost) continue;
    if (u.pathname.replace(/\/$/, "") === self.pathname.replace(/\/$/, "")) continue;
    if (/login|account|auth|signin|sign-in|cart|checkout/i.test(u.pathname)) continue;
    const match = CONTACT_PATHS.find(([re]) => re.test(u.pathname));
    if (!match) continue;
    u.hash = "";
    if (!best || match[1] < best.rank) best = { url: u.toString(), rank: match[1] };
  }
  return best?.url ?? null;
}

// ------------------------------------------------------------ entry point

/**
 * Website (final URL's origin), social profiles, email and phone from one
 * scraped page, plus a same-host contact page to try when email or phone is
 * missing. Email comes from `mailto:` links, else from the markdown; phones
 * only from `tel:` links.
 */
export function extractExternalLinks(page: ScrapedPage): Extracted {
  const website = originOf(page.finalUrl) ?? originOf(page.url);
  const siteHost = website ? bareHost(new URL(website).hostname) : null;
  const links = page.links.filter((l): l is string => typeof l === "string");

  const mailto = links.filter((l) => /^mailto:/i.test(l.trim()));
  let email = pickEmail(mailto, siteHost);
  if (!email && page.markdown) email = pickEmail(page.markdown.match(EMAIL_IN_TEXT_RE) ?? [], siteHost);

  let phone: string | null = null;
  for (const l of links) {
    phone = phoneFromTel(l);
    if (phone) break;
  }

  // Socials: hrefs first, then any profile URL that only appears in the markdown.
  const mdUrls = page.markdown?.match(/https?:\/\/[^\s)\]<>"']+/g) ?? [];
  const socialLinks = { ...pickSocial(mdUrls), ...pickSocial(links) };

  const base = page.finalUrl ?? page.url;
  let contactUrl: string | null = null;
  try {
    contactUrl = pickContactUrl(links, base, siteHost);
  } catch {
    contactUrl = null;
  }

  return { website, socialLinks: ordered(socialLinks), email, phone, contactUrl };
}

function ordered(links: Partial<Record<SocialKey, string>>): Partial<Record<SocialKey, string>> {
  const out: Partial<Record<SocialKey, string>> = {};
  for (const k of SOCIAL_KEYS) if (links[k]) out[k] = links[k];
  return out;
}
