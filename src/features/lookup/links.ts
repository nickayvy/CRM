// Pure link/logo helpers for cards and the dossier (gtm business-card.tsx and
// dossier-modal.tsx).

/** "https://www.acme.com/x" → "acme.com"; null for empty. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const host = url.trim().replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/)[0];
  return host || null;
}

export function absoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Google favicon for a domain-like slug or website; null when neither is a domain. */
export function faviconUrl(slug: string | null, website?: string | null): string | null {
  const domain = slug && slug.includes(".") ? slug : hostOf(website);
  if (!domain || !domain.includes(".")) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

/** Logo fallback chain: logoUrl → Yelp photo → favicon; the caller renders initials when it runs out. */
export function logoChain(b: { logoUrl: string | null; imageUrl?: string | null; slug: string | null; website: string | null }): string[] {
  const chain = [b.logoUrl, b.imageUrl ?? null, faviconUrl(b.slug, b.website)].filter((u): u is string => !!u);
  return [...new Set(chain)];
}

export function initials(name: string, n = 1): string {
  return name.trim().slice(0, n).toUpperCase() || "?";
}

export function socialLink(links: Record<string, string> | null | undefined, ...keys: string[]): string | null {
  if (!links) return null;
  for (const key of keys) {
    const v = links[key] ?? links[key.toLowerCase()];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function metaAdsLibraryUrl(website: string | null): string {
  const base = "https://www.facebook.com/ads/library/";
  const domain = hostOf(website);
  if (!domain) return base;
  return `${base}?active_status=active&ad_type=all&q=${encodeURIComponent(domain)}`;
}

export function trustpilotUrl(b: { trustpilotId: string | null; slug: string | null }): string | null {
  const slug = b.trustpilotId ?? b.slug;
  return slug ? `https://www.trustpilot.com/review/${slug}` : null;
}

export const TRUSTPILOT_REVIEW_PREFIX = "https://www.trustpilot.com/review/";

export function isTrustpilotReviewUrl(url: string): boolean {
  const u = url.trim();
  return u.startsWith(TRUSTPILOT_REVIEW_PREFIX) && u.length > TRUSTPILOT_REVIEW_PREFIX.length;
}
