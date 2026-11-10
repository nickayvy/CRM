import { describe, expect, it } from "vitest";
import type { ScrapedPage } from "@/lib/firecrawl/client";
import {
  cleanEmail,
  cleanWebsiteUrl,
  extractExternalLinks,
  isDomainSlug,
  phoneFromTel,
  socialProfile,
  websiteFromSlug,
} from "@/lib/firecrawl/external-links";

// Pure unit tests for the external-links extractor. No network, no DB.
// Rules: docs/team/links/architecture.md §Validation rules (R7).

/** A scraped page with sensible defaults; tests override only what they care about. */
function page(over: Partial<ScrapedPage> = {}): ScrapedPage {
  return { url: "https://acme.test", finalUrl: null, links: [], markdown: null, ...over };
}

// Real link list scraped from ivimhealth.com (no X/Twitter link on that site).
const IVIM_URL = "https://ivimhealth.com";
const IVIM_FINAL_URL = "https://www.ivimhealth.com/";
const IVIM_LINKS: string[] = [
  "https://www.ivimhealth.com/why-membership/",
  "https://www.ivimhealth.com/my-account/#/?lgrd=https://shop.ivimhealth.com/customer_authentication/login?return_to=%2F",
  "https://shop.ivimhealth.com/",
  "https://community.ivimhealth.com/c/live-q-as/eating-for-emotional-stability-how-nutrition-supports-mood-stress-77c92980-1296-449f-aa25-e473ee0ef676",
  "https://www.ivimhealth.com/",
  "https://www.ivimhealth.com/#",
  "https://www.ivimhealth.com/weight-loss/",
  "https://www.ivimhealth.com/womens-hormone-health/",
  "https://www.ivimhealth.com/mens-hormone-health/",
  "https://www.ivimhealth.com/energy/",
  "https://www.ivimhealth.com/longevity-skin/",
  "https://www.ivimhealth.com/recovery-repair/",
  "https://www.ivimhealth.com/sleep-stress/",
  "https://www.ivimhealth.com/compounded-semaglutide/",
  "https://www.ivimhealth.com/compounded-tirzepatide/",
  "https://www.ivimhealth.com/foundayopill/",
  "https://www.ivimhealth.com/ozempic/",
  "https://www.ivimhealth.com/wegovy/",
  "https://www.ivimhealth.com/wegovypill/",
  "https://www.ivimhealth.com/zepbound/",
  "https://www.ivimhealth.com/dhea-gel/",
  "https://www.ivimhealth.com/estradiol/",
  "https://www.ivimhealth.com/estradiol-hypospray/",
  "https://www.ivimhealth.com/estradiol-patch/",
  "https://www.ivimhealth.com/estradiol-progesterone/",
  "https://www.ivimhealth.com/progesterone/",
  "https://www.ivimhealth.com/pt-141/",
  "https://www.ivimhealth.com/sermorelin/",
  "https://www.ivimhealth.com/enclomiphene/",
  "https://www.ivimhealth.com/enclomiphene-tadalafil/",
  "https://www.ivimhealth.com/b12/",
  "https://www.ivimhealth.com/lipotropic/",
  "https://www.ivimhealth.com/nad/",
  "https://www.ivimhealth.com/membership/",
  "https://www.ivimhealth.com/ivim-at-work/",
  "https://www.ivimhealth.com/blog/",
  "https://www.ivimhealth.com/injection-video/",
  "https://www.ivimhealth.com/medication-safety-information/",
  "https://www.ivimhealth.com/news/",
  "https://www.ivimhealth.com/about-us/",
  "https://www.ivimhealth.com/our-research/",
  "https://www.ivimhealth.com/providers/",
  "https://www.ivimhealth.com/contact/",
  "https://www.ivimhealth.com/my-account/",
  "https://www.ivimhealth.com/jessie-james-decker/",
  "https://www.ivimhealth.com/form/#/medication-access/?product_interest=glp-1",
  "https://www.trustpilot.com/review/ivimhealth.com",
  "https://www.prnewswire.com/news-releases/ivim-health-named-no-38-on-the-2026-inc-5000-list-the-most-prestigious-ranking-of-americas-fastest-growing-private-companies-302848491.html",
  "https://health.usnews.com/best-diet/medication/ivim-health",
  "https://www.ivimhealth.com/dr-jessica-duncan-testifies-before-the-fda-on-behalf-of-patients-seeking-safe-access-to-peptide-therapies/",
  "https://www.ivimhealth.com/about/",
  "https://www.ivimhealth.com/our-services/",
  "https://www.ivimhealth.com/providers",
  "https://ivim.zendesk.com/hc/en-us",
  "https://www.ivimhealth.com/klarna-faqs/",
  "https://www.ivimhealth.com/refund_returns/",
  "https://www.ivimhealth.com/privacy-policy/",
  "https://www.ivimhealth.com/terms-and-conditions/",
  "https://www.ivimhealth.com/hipaa-notice/",
  "https://www.ivimhealth.com/accessibility-statement/",
  "https://www.ivimhealth.com/important-glp-1-safety-information",
  "https://www.tiktok.com/@ivimhealth",
  "https://instagram.com/ivimhealth_",
  "https://youtube.com/@ivimhealth",
  "https://www.facebook.com/ivimhealth",
];

// Real link list scraped from wunder2.com, which redirects to wunderbrow.com.
const WUNDER_URL = "https://wunder2.com";
const WUNDER_FINAL_URL = "https://www.wunderbrow.com/";
const WUNDER_LINKS: string[] = [
  "https://www.wunderbrow.com/collections/gift-sets",
  "https://www.wunderbrow.com/",
  "https://www.wunderbrow.com/collections/best-sellers",
  "https://www.wunderbrow.com/collections/brows",
  "https://www.wunderbrow.com/collections/eyes",
  "https://www.wunderbrow.com/collections/bundles",
  "https://www.wunderbrow.com/pages/special-offers",
  "https://www.wunderbrow.com/pages/discover",
  "https://www.wunderbrow.com/pages/wunderclub",
  "https://www.wunderbrow.com/customer_authentication/redirect?locale=en&region_country=US",
  "https://www.wunderbrow.com/products/wunderbrow-eyebrow-gel",
  "https://www.wunderbrow.com/collections/shop-all",
  "https://www.wunderbrow.com/products/wunderlift",
  "https://www.wunderbrow.com/products/soft-brow-define-fill-powder-duo",
  "https://www.wunderbrow.com/products/super-stay-liner",
  "https://www.wunderbrow.com/products/growth-enhancer-brow-lash-serum",
  "https://www.wunderbrow.com/products/thicker-brow-pen-duo",
  "https://www.instagram.com/wunderbrow/",
  "https://www.wunderbrow.com/pages/frequently-asked-questions",
  "https://www.wunderbrow.com/pages/shipping-returns",
  "https://www.wunderbrow.com/pages/terms-conditions",
  "https://www.wunderbrow.com/pages/privacy-policy",
  "https://www.wunderbrow.com/pages/contact-us",
  "https://www.wunderbrow.com/pages/sitemap",
  "https://www.wunderbrow.com/pages/about-us",
  "https://www.wunderbrow.com/pages/customer-reviews",
  "https://www.facebook.com/wunderbrow",
  "https://www.tiktok.com/@wunderbrow_uk?is_from_webapp=1&sender_device=pc",
  "https://www.wunderbrow.com/collections/new",
  "https://www.wunderbrow.com/collections/face",
  "https://www.wunderbrow.com/account",
  "https://www.wunderbrow.com/cart",
  "https://rebuyengine.com/?shop=wundercosmetics-us.myshopify.com",
  "https://www.wunderbrow.com/collections/all",
  "https://www.wunderbrow.com/products/growth-enhancer-brow-lash-serum?variant=43754146824328&_rdiscovery-handle=growth-enhancer-brow-lash-serum&_rdiscovery-widget=270896",
];

describe("AC-17.1 extractExternalLinks: real homepage fixtures", () => {
  // The real ivimhealth.com list has no X/Twitter link, so this case is the
  // real list plus one appended twitter.com link.
  const ivim = page({
    url: IVIM_URL,
    finalUrl: IVIM_FINAL_URL,
    links: [...IVIM_LINKS, "https://twitter.com/ivimhealth"],
  });

  it("AC-17.1 returns facebook, twitter, instagram, youtube and tiktok profile URLs under those keys", () => {
    expect(extractExternalLinks(ivim).socialLinks).toEqual({
      facebook: "https://www.facebook.com/ivimhealth",
      twitter: "https://twitter.com/ivimhealth",
      instagram: "https://instagram.com/ivimhealth_",
      youtube: "https://youtube.com/@ivimhealth",
      tiktok: "https://www.tiktok.com/@ivimhealth",
    });
  });

  it("AC-17.1 website is the origin of finalUrl and contactUrl is the same-host contact page", () => {
    const out = extractExternalLinks(ivim);
    expect(out.website).toBe("https://www.ivimhealth.com");
    expect(out.contactUrl).toBe("https://www.ivimhealth.com/contact/");
  });

  it("AC-17.1 finds no email or phone when the page has no mailto: or tel: link", () => {
    const out = extractExternalLinks(ivim);
    expect(out.email).toBeNull();
    expect(out.phone).toBeNull();
  });

  it("AC-17.1 the unmodified real ivimhealth.com list has no twitter entry", () => {
    const out = extractExternalLinks(page({ url: IVIM_URL, finalUrl: IVIM_FINAL_URL, links: IVIM_LINKS }));
    expect(out.socialLinks).not.toHaveProperty("twitter");
    expect(Object.keys(out.socialLinks)).toEqual(["facebook", "instagram", "youtube", "tiktok"]);
  });

  it("AC-17.1 wunderbrow fixture: redirects to another domain, website is the final origin", () => {
    const out = extractExternalLinks(page({ url: WUNDER_URL, finalUrl: WUNDER_FINAL_URL, links: WUNDER_LINKS }));
    expect(out.website).toBe("https://www.wunderbrow.com");
    expect(out.socialLinks).toEqual({
      facebook: "https://www.facebook.com/wunderbrow",
      instagram: "https://www.instagram.com/wunderbrow",
      tiktok: "https://www.tiktok.com/@wunderbrow_uk",
    });
    expect(out.contactUrl).toBe("https://www.wunderbrow.com/pages/contact-us");
  });

  it("AC-17.1 falls back to the requested url's origin when there is no finalUrl", () => {
    const out = extractExternalLinks(page({ url: "https://acme.test/some/page?x=1", finalUrl: null }));
    expect(out.website).toBe("https://acme.test");
  });

  it.each([
    ["x.com", "https://x.com/acme", "https://x.com/acme"],
    ["twitter.com", "https://twitter.com/acme", "https://twitter.com/acme"],
    ["mobile.twitter.com", "https://mobile.twitter.com/acme", "https://mobile.twitter.com/acme"],
    ["www.twitter.com with query and trailing slash", "http://www.twitter.com/acme/?ref_src=x#top", "https://www.twitter.com/acme"],
  ])("AC-17.1 %s profile lands under the twitter key", (_label, href, expected) => {
    expect(extractExternalLinks(page({ links: [href] })).socialLinks).toEqual({ twitter: expected });
    expect(socialProfile(href)).toEqual({ key: "twitter", url: expected });
  });

  it("AC-17.1 normalizes to https and drops query, fragment and trailing slash", () => {
    const links = [
      "http://www.facebook.com/acme/?ref=page_internal#about",
      "http://instagram.com/acme.shop/?hl=en",
      "http://www.tiktok.com/@acme_official/?lang=en",
      "http://www.youtube.com/@AcmeTV?sub_confirmation=1",
    ];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({
      facebook: "https://www.facebook.com/acme",
      instagram: "https://instagram.com/acme.shop",
      youtube: "https://www.youtube.com/@AcmeTV",
      tiktok: "https://www.tiktok.com/@acme_official",
    });
  });

  it("AC-17.1 accepts youtube channel/user/c URLs and facebook profile.php ids", () => {
    expect(socialProfile("https://www.youtube.com/channel/UC123abc")).toEqual({
      key: "youtube",
      url: "https://www.youtube.com/channel/UC123abc",
    });
    expect(socialProfile("https://www.youtube.com/user/acme")).toEqual({
      key: "youtube",
      url: "https://www.youtube.com/user/acme",
    });
    expect(socialProfile("https://www.facebook.com/profile.php?id=12345&sk=about")).toEqual({
      key: "facebook",
      url: "https://www.facebook.com/profile.php?id=12345",
    });
    expect(socialProfile("https://www.facebook.com/profile.php?id=abc")).toBeNull();
  });
});

describe("AC-17.2 social links that must never be returned", () => {
  const SHARE_LINKS = [
    "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Facme.test",
    "https://www.facebook.com/sharer.php?u=https%3A%2F%2Facme.test",
    "https://twitter.com/intent/tweet?text=Hello",
    "https://twitter.com/share?url=https%3A%2F%2Facme.test",
    "https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Facme.test",
  ];
  const BARE_ROOTS = [
    "https://facebook.com",
    "https://www.facebook.com/",
    "https://twitter.com/",
    "https://x.com",
    "https://www.linkedin.com/",
    "https://instagram.com/",
    "https://www.youtube.com/",
    "https://www.tiktok.com/",
  ];
  const NON_HTTP = ["javascript:alert(1)", "javascript:void(0)", "data:text/html,<a href=https://facebook.com/acme>", "ftp://facebook.com/acme"];
  const LOOK_ALIKES = [
    "https://facebook.com.evil.test/acme",
    "https://notfacebook.com/acme",
    "https://x.com.evil.test/acme",
    "https://evil-twitter.com/acme",
  ];
  const LOGIN_POLICY = [
    "https://www.facebook.com/login",
    "https://www.facebook.com/policies",
    "https://www.instagram.com/accounts/login",
    "https://www.youtube.com/watch?v=abc",
  ];

  describe.each([
    ["share/intent links", SHARE_LINKS],
    ["bare platform roots", BARE_ROOTS],
    ["javascript:/data:/non-http schemes", NON_HTTP],
    ["look-alike hosts", LOOK_ALIKES],
    ["login/policy/video URLs", LOGIN_POLICY],
  ])("AC-17.2 %s", (_label, urls) => {
    it.each(urls)("extractExternalLinks ignores %s", (href) => {
      expect(extractExternalLinks(page({ links: [href] })).socialLinks).toEqual({});
    });

    it.each(urls)("socialProfile(%s) is null", (href) => {
      expect(socialProfile(href)).toBeNull();
    });
  });

  it("AC-17.2 a page with only bad links returns an empty socialLinks object", () => {
    const links = [...SHARE_LINKS, ...BARE_ROOTS, ...NON_HTTP, ...LOOK_ALIKES, ...LOGIN_POLICY];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({});
  });

  it("AC-17.2 bad links do not displace a good profile on the same page", () => {
    const links = [...SHARE_LINKS, "https://www.facebook.com/acme", ...LOGIN_POLICY];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({ facebook: "https://www.facebook.com/acme" });
  });

  it.each([null, undefined, "", "   ", "not a url"])("AC-17.2 socialProfile(%j) is null", (value) => {
    expect(socialProfile(value)).toBeNull();
  });
});

describe("R7 platform precedence", () => {
  it("a LinkedIn /company/ URL wins over an /in/ URL when /in/ comes first", () => {
    const links = ["https://www.linkedin.com/in/jane-doe", "https://www.linkedin.com/company/acme"];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({
      linkedin: "https://www.linkedin.com/company/acme",
    });
  });

  it("a LinkedIn /company/ URL wins over an /in/ URL when /company/ comes first", () => {
    const links = ["https://www.linkedin.com/company/acme/", "https://www.linkedin.com/in/jane-doe"];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({
      linkedin: "https://www.linkedin.com/company/acme",
    });
  });

  it("an /in/ URL is kept when it is the only LinkedIn link", () => {
    const out = extractExternalLinks(page({ links: ["https://www.linkedin.com/in/jane-doe"] }));
    expect(out.socialLinks).toEqual({ linkedin: "https://www.linkedin.com/in/jane-doe" });
  });

  it("the first acceptable link wins for a platform without a ranking (two facebook pages)", () => {
    const links = ["https://www.facebook.com/first.page", "https://www.facebook.com/second.page"];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({ facebook: "https://www.facebook.com/first.page" });
  });

  it("the first acceptable link wins even when a rejected link precedes it", () => {
    const links = ["https://www.facebook.com/sharer/sharer.php?u=x", "https://www.facebook.com/real.page"];
    expect(extractExternalLinks(page({ links })).socialLinks).toEqual({ facebook: "https://www.facebook.com/real.page" });
  });
});

describe("email extraction", () => {
  it("takes the address from a mailto: link, strips ?subject= and lowercases", () => {
    const out = extractExternalLinks(page({ links: ["mailto:Info@Acme.Test?subject=Hello%20there"] }));
    expect(out.email).toBe("info@acme.test");
  });

  it("falls back to the markdown when there is no mailto: link", () => {
    const out = extractExternalLinks(page({ markdown: "Write to us at Sales@Acme.Test or call." }));
    expect(out.email).toBe("sales@acme.test");
  });

  it("prefers a mailto: link over an address in the markdown", () => {
    const out = extractExternalLinks(
      page({ links: ["mailto:hello@acme.test"], markdown: "Press: press@other-firm.test" }),
    );
    expect(out.email).toBe("hello@acme.test");
  });

  it("prefers an address on the site's own domain over an earlier one", () => {
    const out = extractExternalLinks(
      page({
        url: "https://www.acme.test",
        links: ["mailto:someone@gmail.com", "mailto:agency@designers.test", "mailto:hello@acme.test"],
      }),
    );
    expect(out.email).toBe("hello@acme.test");
  });

  it("prefers an on-domain address in the markdown too (www. prefix ignored)", () => {
    const out = extractExternalLinks(
      page({ finalUrl: "https://www.acme.test/", markdown: "cc: agency@designers.test, contact: team@acme.test" }),
    );
    expect(out.email).toBe("team@acme.test");
  });

  it("keeps the first valid address when none is on the site's domain", () => {
    const out = extractExternalLinks(page({ links: ["mailto:first@one.test", "mailto:second@two.test"] }));
    expect(out.email).toBe("first@one.test");
  });

  it("skips a rejected mailto: and uses the next valid one", () => {
    const out = extractExternalLinks(page({ links: ["mailto:noreply@acme.test", "mailto:care@acme.test"] }));
    expect(out.email).toBe("care@acme.test");
  });

  it("falls back to the markdown when every mailto: link is rejected", () => {
    const out = extractExternalLinks(page({ links: ["mailto:you@example.com"], markdown: "Email: real@acme.test" }));
    expect(out.email).toBe("real@acme.test");
  });

  it.each([
    "logo@2x.png",
    "icon@3x.webp",
    "you@example.com",
    "name@domain.com",
    "noreply@acme.com",
    "abc123@sentry.io",
    "abc123@o12345.ingest.sentry.io",
    "abc123@sentry-next.wixpress.com",
    "abc123@wixpress.com",
  ])("rejects %s (asset name or placeholder) from mailto: and from markdown", (bad) => {
    expect(extractExternalLinks(page({ links: [`mailto:${bad}`] })).email).toBeNull();
    expect(extractExternalLinks(page({ markdown: `Contact ${bad} today` })).email).toBeNull();
  });
});

describe("cleanEmail", () => {
  it.each([
    ["info@acme.com", "info@acme.com"],
    ["  Info@Acme.COM ", "info@acme.com"],
    ["mailto:Info@Acme.com", "info@acme.com"],
    ["MAILTO:info@acme.com?subject=Hi&body=There", "info@acme.com"],
    ["mailto:first.last+tag@sub.acme.co.uk", "first.last+tag@sub.acme.co.uk"],
    ["mailto:info%40acme.com", "info@acme.com"],
  ])("cleanEmail(%j) -> %j", (input, expected) => {
    expect(cleanEmail(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "not an email",
    "info@",
    "@acme.com",
    "info@acme",
    "logo@2x.png",
    "icon@3x.webp",
    "sprite@2x.svg",
    "you@example.com",
    "name@domain.com",
    "noreply@acme.com",
    "no-reply@acme.com",
    "x@sentry.io",
    "x@o1.ingest.sentry.io",
    "x@sentry-next.wixpress.com",
    "5f2b3c4d5e6f7a8b9c0d1e2f@acme.com",
    "mailto:%E0%A4%A@acme.com",
  ])("cleanEmail(%j) is null", (input) => {
    expect(cleanEmail(input)).toBeNull();
  });
});

describe("phone extraction", () => {
  it("takes the phone from a tel: link as written", () => {
    expect(extractExternalLinks(page({ links: ["tel:+1-800-555-0100"] })).phone).toBe("+1-800-555-0100");
  });

  it("decodes percent-encoding and drops non-phone characters", () => {
    expect(extractExternalLinks(page({ links: ["tel:%2B1%20(800)%20555-0100"] })).phone).toBe("+1 (800) 555-0100");
  });

  it("does NOT pick up a phone number that only appears in the markdown", () => {
    const out = extractExternalLinks(page({ markdown: "Call us on +1 (800) 555-0100 or 020 7946 0958" }));
    expect(out.phone).toBeNull();
  });

  it("rejects a tel: link with fewer than 7 digits", () => {
    expect(extractExternalLinks(page({ links: ["tel:123456"] })).phone).toBeNull();
  });

  it("skips a too-short tel: link and takes the next valid one", () => {
    const out = extractExternalLinks(page({ links: ["tel:12345", "tel:+44 20 7946 0958"] }));
    expect(out.phone).toBe("+44 20 7946 0958");
  });

  it("takes the first valid tel: link on the page", () => {
    const out = extractExternalLinks(page({ links: ["tel:+15550100100", "tel:+15550100200"] }));
    expect(out.phone).toBe("+15550100100");
  });
});

describe("phoneFromTel", () => {
  it.each([
    ["tel:+1-800-555-0100", "+1-800-555-0100"],
    ["TEL:+15550100100", "+15550100100"],
    ["  tel:1234567  ", "1234567"],
    ["tel:555.010.0100", "555.010.0100"],
    ["tel:+15550100100;ext=22", "+15550100100"],
    ["tel:+15550100100?foo=bar", "+15550100100"],
  ])("phoneFromTel(%j) -> %j", (input, expected) => {
    expect(phoneFromTel(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "tel:",
    "tel:123456",
    "tel:12-34-56",
    "tel:1234567890123456",
    "+15550100100",
    "https://acme.com/tel:5550100100",
    "mailto:info@acme.com",
    "tel:%E0%A4%A",
  ])("phoneFromTel(%j) is null", (input) => {
    expect(phoneFromTel(input)).toBeNull();
  });
});

describe("AC-17.3 cleanWebsiteUrl", () => {
  it("drops utm_* parameters and the trailing slash left behind", () => {
    expect(
      cleanWebsiteUrl("http://www.acme.com/?utm_medium=company_profile&utm_source=trustpilot&utm_campaign=domain_click"),
    ).toBe("http://www.acme.com");
  });

  it("keeps non-tracking parameters while dropping utm_*", () => {
    expect(cleanWebsiteUrl("https://acme.com/shop?ref=abc&utm_source=x&page=2")).toBe(
      "https://acme.com/shop?ref=abc&page=2",
    );
  });

  it("drops click-id parameters (fbclid, gclid)", () => {
    expect(cleanWebsiteUrl("https://acme.com/?fbclid=123&gclid=456&keep=1")).toBe("https://acme.com/?keep=1");
  });

  it("drops fragments", () => {
    expect(cleanWebsiteUrl("https://acme.com/shop#team")).toBe("https://acme.com/shop");
    expect(cleanWebsiteUrl("https://acme.com/#top")).toBe("https://acme.com");
  });

  it("removes a bare trailing slash but keeps a path", () => {
    expect(cleanWebsiteUrl("https://acme.com/")).toBe("https://acme.com");
    expect(cleanWebsiteUrl("https://acme.com/shop/")).toBe("https://acme.com/shop/");
  });

  it("lowercases the host and drops credentials", () => {
    expect(cleanWebsiteUrl("https://user:pw@WWW.Acme.COM/Shop")).toBe("https://www.acme.com/Shop");
  });

  it("gives a scheme-less domain https:// (www.acme.com/shop)", () => {
    expect(cleanWebsiteUrl("www.acme.com/shop")).toBe("https://www.acme.com/shop");
    expect(cleanWebsiteUrl("acme.com")).toBe("https://acme.com");
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "ftp://acme.com",
    "javascript:alert(1)",
    "mailto:a@b.com",
    "not a url",
    "acme",
    "http://localhost:3000",
  ])("cleanWebsiteUrl(%j) is null", (input) => {
    expect(cleanWebsiteUrl(input)).toBeNull();
  });
});

describe("AC-17.3 websiteFromSlug and isDomainSlug", () => {
  it("websiteFromSlug turns a domain slug into an https URL", () => {
    expect(websiteFromSlug("acme.com")).toBe("https://acme.com");
  });

  it("websiteFromSlug lowercases and trims", () => {
    expect(websiteFromSlug("Acme.CO.uk ")).toBe("https://acme.co.uk");
    expect(websiteFromSlug("www.acme.co.uk")).toBe("https://www.acme.co.uk");
  });

  it.each(["acme", "", "acme com", "-acme.com", "acme.c", "acme..com", null, undefined])(
    "websiteFromSlug(%j) is null",
    (slug) => {
      expect(websiteFromSlug(slug)).toBeNull();
    },
  );

  it.each(["acme.com", "www.acme.co.uk", "Acme.CO.uk ", " acme.com", "my-shop.io", "xn--bcher-kva.example"])(
    "isDomainSlug(%j) is true",
    (slug) => {
      expect(isDomainSlug(slug)).toBe(true);
    },
  );

  it.each(["acme", "", "acme com", "-acme.com", "acme.c", "https://acme.com", "acme.com/shop", null, undefined])(
    "isDomainSlug(%j) is false",
    (slug) => {
      expect(isDomainSlug(slug)).toBe(false);
    },
  );
});
