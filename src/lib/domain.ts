// Website domains for duplicate detection and cross-source matching. Pure;
// safe in client bundles.

/**
 * Same pattern as the generated column `businesses.website_domain`
 * (src/db/schema.ts WEBSITE_DOMAIN_SQL), applied to the lower-cased, trimmed
 * value: optional scheme (with optional userinfo), optional "www.", a dotted host
 * (captured), optional trailing dot and port, then a path delimiter or the end.
 */
const WEBSITE_DOMAIN_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?::[0-9]*)?(?:[/?#]|$)/;

/** "https://www.Acme.com/x" → "acme.com"; null for empty or unparsable. */
export function websiteDomain(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const m = WEBSITE_DOMAIN_RE.exec(url.trim().toLowerCase());
  return m ? m[1] : null;
}

/**
 * Hosts many unrelated businesses share: social networks, link-in-bio and
 * listing sites, free site builders, booking and ordering platforms, and
 * free-mail providers. A match on one of these (or a subdomain) says nothing
 * about whether two businesses are the same.
 */
export const SHARED_HOSTS: readonly string[] = [
  // social, link-in-bio, listings
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "linktr.ee",
  "linkin.bio",
  "beacons.ai",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "linkedin.com",
  "pinterest.com",
  "nextdoor.com",
  "yelp.com",
  "google.com",
  "goo.gl",
  "g.page",
  "g.co",
  "maps.app.goo.gl",
  "bbb.org",
  "yellowpages.com",
  "mapquest.com",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "thumbtack.com",
  "houzz.com",
  "porch.com",
  "trustpilot.com",
  "tripadvisor.com",
  // free site builders and hosts
  "business.site",
  "wixsite.com",
  "wix.com",
  "editorx.io",
  "squarespace.com",
  "square.site",
  "godaddysites.com",
  "weebly.com",
  "wordpress.com",
  "blogspot.com",
  "carrd.co",
  "webflow.io",
  "jimdosite.com",
  "site123.me",
  "mailchimpsites.com",
  "ueniweb.com",
  "github.io",
  "netlify.app",
  "vercel.app",
  "myshopify.com",
  "hubspotpagebuilder.com",
  // booking and ordering platforms
  "booksy.com",
  "vagaro.com",
  "styleseat.com",
  "schedulicity.com",
  "setmore.com",
  "fresha.com",
  "mindbodyonline.com",
  "toasttab.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "opentable.com",
  "clover.com",
  // free mail
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
];

const SHARED = new Set(SHARED_HOSTS);

/** True for hosts many unrelated businesses share (see SHARED_HOSTS) and their subdomains. */
export function isSharedHost(domain: string): boolean {
  let d = domain.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!d) return false;
  for (;;) {
    if (SHARED.has(d)) return true;
    const dot = d.indexOf(".");
    if (dot < 0) return false;
    d = d.slice(dot + 1);
  }
}

/** The domain to compare for duplicates and matching: `websiteDomain(url)` unless it is a shared host. */
export function matchableDomain(url: string | null | undefined): string | null {
  const d = websiteDomain(url);
  return d && !isSharedHost(d) ? d : null;
}
