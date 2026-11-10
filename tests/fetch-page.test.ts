import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScrapedPage } from "@/lib/firecrawl/client";
import { extractExternalLinks } from "@/lib/firecrawl/external-links";
import { MAX_BODY_BYTES, PageHttpError, UnsafeUrlError, USER_AGENT, fetchPage } from "@/lib/web/fetch-page";
import { decodeCfEmail, decodeEntities, extractLinks, extractText } from "@/lib/web/html";
import { createPinnedFetch } from "@/lib/web/pinned-fetch";
import { addressRefusal } from "@/lib/web/ssrf";

// ------------------------------------------------------------ helpers

type Served = Response | (() => Response);

/** A stub fetch serving exact URLs; every call is recorded. Unknown URLs fail the test loudly. */
function stubFetch(routes: Record<string, Served>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const r = routes[url];
    if (!r) throw new Error(`stub fetch: no route for ${url}`);
    return typeof r === "function" ? r() : r.clone();
  }) as typeof fetch;
  return { fn, calls };
}

const html = (body: string, headers: Record<string, string> = {}) => () =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const redirect = (to: string, status = 301) => () => new Response(null, { status, headers: { location: to } });

/** Every name resolves to one public address (no DNS in tests). */
const publicLookup = async () => ["93.184.216.34"];

/** Cloudflare's encoding of `email` with XOR key `key`. */
function cfEncode(email: string, key = 0x42): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return hex(key) + [...Buffer.from(email, "utf8")].map((b) => hex(b ^ key)).join("");
}

const SMALL_BUSINESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hill Country Plumbing &amp; Drain | Austin, TX</title>
  <style>.hero { color: red; } /* STYLE-SENTINEL */</style>
  <script>window.tracking = "SCRIPT-SENTINEL"; var s = "<a href='https://evil.example/in-script'>";</script>
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">Home</a>
      <a href="/services">Services</a>
      <a href="/contact">Contact us</a>
      <a href="#top">Top</a>
      <a href="javascript:void(0)">Menu</a>
    </nav>
  </header>
  <main>
    <h1>Family-owned plumbers since 1982</h1>
    <p>Same-day repairs for leaks, water heaters &amp; drains across the Austin area.</p>
    <p>Call <a href="tel:+1-512-555-0142">(512) 555-0142</a> &mdash; we answer 24/7.</p>
  </main>
  <!-- <a href="https://www.facebook.com/commented-out">old</a> -->
  <footer>
    <p>Email <a href="mailto:info@hillcountryplumbing.com">info@hillcountryplumbing.com</a></p>
    <a href="https://www.facebook.com/hillcountryplumbing" target="_blank" rel="noopener">Facebook</a>
    <a href='https://www.instagram.com/hillcountryplumbing/'>Instagram</a>
    <a href=https://www.facebook.com/sharer/sharer.php?u=x>Share</a>
    <p>&copy; 2026 Hill Country Plumbing</p>
  </footer>
  <noscript>NOSCRIPT-SENTINEL</noscript>
</body>
</html>`;

// ------------------------------------------------------------ AC-19.1

describe("AC-19.1 fetchPage parses an HTML page into a ScrapedPage", () => {
  const url = "https://www.hillcountryplumbing.com";

  it("resolves absolute and relative hrefs, keeps mailto:/tel:, drops script/style text", async () => {
    const { fn, calls } = stubFetch({ [`${url}/`]: html(SMALL_BUSINESS_HTML) });
    const page = (await fetchPage(url, { fetch: fn, lookup: publicLookup }))!;

    expect(page.url).toBe(url);
    expect(page.finalUrl).toBe(`${url}/`);
    expect(page.links).toEqual([
      `${url}/`,
      `${url}/services`,
      `${url}/contact`,
      "tel:+1-512-555-0142",
      "mailto:info@hillcountryplumbing.com",
      "https://www.facebook.com/hillcountryplumbing",
      "https://www.instagram.com/hillcountryplumbing/",
      "https://www.facebook.com/sharer/sharer.php?u=x",
    ]);
    expect(page.markdown).toContain("Family-owned plumbers since 1982");
    expect(page.markdown).toContain("leaks, water heaters & drains");
    expect(page.markdown).toContain("Hill Country Plumbing & Drain | Austin, TX");
    expect(page.markdown).toContain("© 2026");
    for (const hidden of ["SCRIPT-SENTINEL", "STYLE-SENTINEL", "NOSCRIPT-SENTINEL", "evil.example", "commented-out", "<"]) {
      expect(page.markdown).not.toContain(hidden);
    }
    // One request, with a generic browser-like UA and manual redirects.
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("user-agent")).toBe(USER_AGENT);
    expect(headers.get("accept")).toMatch(/^text\/html/);
    expect(calls[0].init?.redirect).toBe("manual");
  });

  it("resolves hrefs against <base href>", async () => {
    const { fn } = stubFetch({
      "https://acme.com/": html(`<base href="https://acme.com/en/"><a href="contact">c</a><a href="/about">a</a>`),
    });
    const page = (await fetchPage("https://acme.com/", { fetch: fn, lookup: publicLookup }))!;
    expect(page.links).toEqual(["https://acme.com/en/contact", "https://acme.com/about"]);
  });

  it("decodes Cloudflare-protected emails (data-cfemail and the email-protection href)", async () => {
    const a = cfEncode("info@acmeroofing.com");
    const b = cfEncode("sales@acmeroofing.com", 0x7f);
    const { fn } = stubFetch({
      "https://acmeroofing.com/": html(
        `<p>Write to <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${a}">[email&#160;protected]</a></p>
         <p><a href="/cdn-cgi/l/email-protection#${b}">Email sales</a></p>`,
      ),
    });
    const page = (await fetchPage("https://acmeroofing.com/", { fetch: fn, lookup: publicLookup }))!;
    expect(page.links).toEqual(["mailto:info@acmeroofing.com", "mailto:sales@acmeroofing.com"]);
    expect(page.markdown).toContain("Write to info@acmeroofing.com");
    expect(page.markdown).not.toContain("protected");
    expect(extractExternalLinks(page).email).toBe("info@acmeroofing.com");
  });

  it("resolves null for a non-HTML response (application/pdf) and for an empty page", async () => {
    const { fn } = stubFetch({
      "https://acme.com/menu.pdf": () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
      "https://acme.com/blank": html("<html><head></head><body>   </body></html>"),
      "https://acme.com/untyped": () => new Response("<a href='/x'>x</a>"),
    });
    expect(await fetchPage("https://acme.com/menu.pdf", { fetch: fn, lookup: publicLookup })).toBeNull();
    expect(await fetchPage("https://acme.com/blank", { fetch: fn, lookup: publicLookup })).toBeNull();
    expect(await fetchPage("https://acme.com/untyped", { fetch: fn, lookup: publicLookup })).toBeNull();
  });

  it("accepts application/xhtml+xml", async () => {
    const { fn } = stubFetch({
      "https://acme.com/": () => new Response("<p>Hello</p>", { headers: { "content-type": "application/xhtml+xml" } }),
    });
    expect((await fetchPage("https://acme.com/", { fetch: fn, lookup: publicLookup }))?.markdown).toBe("Hello");
  });

  it("rejects a 404 (PageHttpError with the status) and a 500", async () => {
    const { fn } = stubFetch({
      "https://acme.com/gone": () => new Response("not found", { status: 404, headers: { "content-type": "text/html" } }),
      "https://acme.com/boom": () => new Response("oops", { status: 500 }),
    });
    const err = await fetchPage("https://acme.com/gone", { fetch: fn, lookup: publicLookup }).catch((e) => e);
    expect(err).toBeInstanceOf(PageHttpError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("https://acme.com/gone answered HTTP 404");
    await expect(fetchPage("https://acme.com/boom", { fetch: fn, lookup: publicLookup })).rejects.toThrow("HTTP 500");
  });

  it("stops reading a body larger than the cap and still parses what it got", async () => {
    const head = `<html><body><a href="mailto:owner@bigpage.com">mail</a><p>Welcome to Big Page</p><p>`;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let served = 0;
    let pulls = 0;
    const totalChunks = 64; // 4 MB on offer
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(head));
        served += head.length;
      },
      pull(c) {
        pulls++;
        if (pulls > totalChunks) {
          c.enqueue(new TextEncoder().encode(`</p><a href="https://www.facebook.com/past-the-cap">fb</a></body></html>`));
          c.close();
          return;
        }
        c.enqueue(chunk);
        served += chunk.byteLength;
      },
    });
    const { fn } = stubFetch({
      "https://bigpage.com/": () => new Response(body, { headers: { "content-type": "text/html" } }),
    });

    const page = (await fetchPage("https://bigpage.com/", { fetch: fn, lookup: publicLookup }))!;

    expect(page.links).toEqual(["mailto:owner@bigpage.com"]); // the link past the cap was never read
    expect(page.markdown).toContain("Welcome to Big Page");
    expect(page.markdown!.length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(served).toBeLessThan(MAX_BODY_BYTES + 3 * chunk.byteLength); // stopped near the cap, not 4 MB
    expect(pulls).toBeLessThan(totalChunks);
  });

  it("follows redirects by hand; finalUrl is the last hop and relative Locations resolve", async () => {
    const { fn, calls } = stubFetch({
      "http://acme.com/": redirect("https://acme.com/"),
      "https://acme.com/": redirect("/home", 302),
      "https://acme.com/home": redirect("https://www.acme.com/home", 308),
      "https://www.acme.com/home": html(`<a href="contact">Contact</a>`),
    });
    const page = (await fetchPage("http://acme.com/", { fetch: fn, lookup: publicLookup }))!;
    expect(page.url).toBe("http://acme.com/");
    expect(page.finalUrl).toBe("https://www.acme.com/home");
    expect(page.links).toEqual(["https://www.acme.com/contact"]);
    expect(calls.map((c) => c.url)).toEqual([
      "http://acme.com/",
      "https://acme.com/",
      "https://acme.com/home",
      "https://www.acme.com/home",
    ]);
    expect(extractExternalLinks(page).website).toBe("https://www.acme.com");
  });

  it("follows 5 redirects but rejects a 6-redirect chain", async () => {
    const chain = (n: number, last: Served) => {
      const routes: Record<string, Served> = {};
      for (let i = 0; i < n; i++) routes[`https://r.com/${i}`] = redirect(`https://r.com/${i + 1}`);
      routes[`https://r.com/${n}`] = last;
      return stubFetch(routes);
    };
    const five = chain(5, html("<p>made it</p>"));
    expect((await fetchPage("https://r.com/0", { fetch: five.fn, lookup: publicLookup }))?.finalUrl).toBe("https://r.com/5");

    const six = chain(6, html("<p>too far</p>"));
    await expect(fetchPage("https://r.com/0", { fetch: six.fn, lookup: publicLookup })).rejects.toThrow(/more than 5 redirects/);
    expect(six.calls).toHaveLength(6); // the 7th URL is never requested
  });

  it("rejects a redirect without a Location", async () => {
    const { fn } = stubFetch({ "https://acme.com/": () => new Response(null, { status: 302 }) });
    await expect(fetchPage("https://acme.com/", { fetch: fn, lookup: publicLookup })).rejects.toThrow(/without a Location/);
  });

  it("times out a hung response", async () => {
    const hung = (async (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    await expect(fetchPage("https://slow.com/", { fetch: hung, lookup: publicLookup, timeoutMs: 50 })).rejects.toThrow(
      "https://slow.com/ timed out after 50 ms",
    );
  });

  it("never has more than 2 requests in flight to one host; other hosts are not held up", async () => {
    let busy = 0;
    let maxBusy = 0;
    let otherDoneWhileBusyQueued = false;
    const slow = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://busy.com")) {
        busy++;
        maxBusy = Math.max(maxBusy, busy);
        await new Promise((r) => setTimeout(r, 20));
        busy--;
      }
      return new Response("<p>hi</p>", { headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    const same = Array.from({ length: 6 }, (_, i) => fetchPage(`https://busy.com/p${i}`, { fetch: slow, lookup: publicLookup }));
    await fetchPage("https://other.com/", { fetch: slow, lookup: publicLookup });
    otherDoneWhileBusyQueued = busy > 0;
    await Promise.all(same);
    expect(maxBusy).toBe(2);
    expect(otherDoneWhileBusyQueued).toBe(true);
  });

  it("decodes a non-UTF-8 charset from the header or a <meta>", async () => {
    const latin1 = Buffer.from("<p>Caf\xe9 &amp; Cr\xeape</p>", "latin1");
    const { fn } = stubFetch({
      "https://cafe.com/": () => new Response(latin1, { headers: { "content-type": "text/html; charset=iso-8859-1" } }),
      "https://cafe.com/meta": () =>
        new Response(Buffer.concat([Buffer.from('<meta charset="windows-1252">'), latin1]), { headers: { "content-type": "text/html" } }),
    });
    expect((await fetchPage("https://cafe.com/", { fetch: fn, lookup: publicLookup }))?.markdown).toBe("Café & Crêpe");
    expect((await fetchPage("https://cafe.com/meta", { fetch: fn, lookup: publicLookup }))?.markdown).toBe("Café & Crêpe");
  });
});

// ------------------------------------------------------------ AC-19.2

describe("AC-19.2 SSRF guard: refused before the request is sent", () => {
  const refused = [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://example.com:22/",
    "ftp://example.com/",
    "http://user:pw@example.com/",
    // Same family, other spellings and ranges.
    "http://2130706433/", // 127.0.0.1 as one number
    "http://0x7f.0.0.1/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/", // 169.254.169.254, IPv4-mapped
    "http://[fe80::1]/",
    "http://[fd00:ec2::254]/", // unique-local (AWS IMDS over IPv6)
    "http://100.64.0.1/",
    "http://172.16.5.4/",
    "http://192.168.1.1/",
    "http://0.0.0.0/",
    "http://[::]/",
    "http://224.0.0.1/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://printer.local/",
    "http://app.localhost/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://example.com:8443/",
  ];

  for (const url of refused) {
    it(`refuses ${url}`, async () => {
      const { fn, calls } = stubFetch({});
      const lookups: string[] = [];
      const lookup = async (h: string) => (lookups.push(h), ["93.184.216.34"]);
      await expect(fetchPage(url, { fetch: fn, lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(calls).toEqual([]);
    });
  }

  it("refuses a hostname whose lookup answers 10.0.0.5, without fetching", async () => {
    const { fn, calls } = stubFetch({});
    const lookups: string[] = [];
    const lookup = async (h: string) => (lookups.push(h), ["10.0.0.5"]);
    await expect(fetchPage("https://internal-shop.com/", { fetch: fn, lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(lookups).toEqual(["internal-shop.com"]);
    expect(calls).toEqual([]);
  });

  it("refuses when any one of several answers is private", async () => {
    const { fn, calls } = stubFetch({});
    const lookup = async () => ["93.184.216.34", "2606:2800:220:1::1", "fd12:3456::1"];
    await expect(fetchPage("https://mixed.com/", { fetch: fn, lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toEqual([]);
  });

  it("refuses a public URL that redirects to http://192.168.1.1/; the unsafe hop is never fetched", async () => {
    const { fn, calls } = stubFetch({ "https://shop.com/": redirect("http://192.168.1.1/") });
    await expect(fetchPage("https://shop.com/", { fetch: fn, lookup: publicLookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls.map((c) => c.url)).toEqual(["https://shop.com/"]);
  });

  it("refuses a redirect to a name that resolves privately, and to another scheme", async () => {
    const lookup = async (h: string) => (h === "rebind.shop.com" ? ["127.0.0.1"] : ["93.184.216.34"]);
    const a = stubFetch({ "https://shop.com/": redirect("https://rebind.shop.com/") });
    await expect(fetchPage("https://shop.com/", { fetch: a.fn, lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(a.calls.map((c) => c.url)).toEqual(["https://shop.com/"]);
    const b = stubFetch({ "https://shop.com/": redirect("file:///etc/passwd") });
    await expect(fetchPage("https://shop.com/", { fetch: b.fn, lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(b.calls).toHaveLength(1);
  });

  it("a resolver failure rejects as a plain error (a site failure), not UnsafeUrlError", async () => {
    const lookup = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND nowhere.invalid"), { code: "ENOTFOUND" });
    };
    const err = await fetchPage("https://nowhere.invalid/", { fetch: stubFetch({}).fn, lookup }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("addressRefusal", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.31.255.255", "private"],
    ["192.168.0.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.127.0.1", "CGNAT"],
    ["0.0.0.0", "unspecified/this-network"],
    ["239.1.1.1", "multicast"],
    ["255.255.255.255", "reserved/broadcast"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::abcd%eth0", "link-local"],
    ["fc00::1", "unique-local"],
    ["fdff:ffff::1", "unique-local"],
    ["ff02::1", "multicast"],
    ["::ffff:10.0.0.5", "private"],
    ["::ffff:7f00:1", "loopback"],
    ["64:ff9b::a9fe:a9fe", "link-local"],
    ["2002:c0a8:0101::1", "private"],
    ["not-an-ip", "not an IP address"],
  ])("%s → %s", (ip, why) => {
    expect(addressRefusal(ip)).toBe(why);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2a00:1450:4001:80b::200e"])(
    "%s is public",
    (ip) => {
      expect(addressRefusal(ip)).toBeNull();
    },
  );
});

// ------------------------------------------------------------ default transport

describe("default transport pins the connection to vetted addresses", () => {
  let server: Server;
  let port: number;
  let connections = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/gz") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync(`<a href="mailto:hi@local.test">hi</a><p>ua=${req.headers["user-agent"]}</p>`));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<p>hello</p>");
    });
    server.on("connection", () => connections++);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("refuses at connect time when the socket's own lookup answers a private address (DNS rebinding)", async () => {
    const before = connections;
    // The pre-check sees a public address, the socket's lookup then gets loopback.
    let n = 0;
    const lookup = async () => (n++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]);
    await expect(fetchPage("http://rebinding.test/", { lookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(n).toBe(2);
    expect(connections).toBe(before);
  });

  it("createPinnedFetch refuses a name resolving to loopback, and a literal private IP, without connecting", async () => {
    const before = connections;
    const pinned = createPinnedFetch({ resolve: async () => ["127.0.0.1"] });
    await expect(pinned(`http://shop.test:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(pinned(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(connections).toBe(before);
  });

  it("with a permissive `allow` (tests only) it reaches a local server and decodes gzip", async () => {
    const pinned = createPinnedFetch({ resolve: async () => ["127.0.0.1"], allow: () => true });
    const res = await pinned(`http://shop.test:${port}/gz`, { headers: { "user-agent": USER_AGENT, "accept-encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    const body = await res.text();
    expect(body).toContain("mailto:hi@local.test");
    expect(body).toContain(`ua=${USER_AGENT}`);
  });
});

// ------------------------------------------------------------ AC-19.3

describe("AC-19.3 a direct page extracts the same links as the Firecrawl page", () => {
  it("website, socials, email, phone and contact page match the Firecrawl-shaped fixture", async () => {
    const url = "https://www.hillcountryplumbing.com";
    const { fn } = stubFetch({ [`${url}/`]: html(SMALL_BUSINESS_HTML) });
    const direct = (await fetchPage(url, { fetch: fn, lookup: publicLookup }))!;

    // What Firecrawl returns for the same page: absolute links, markdown with link syntax.
    const firecrawl: ScrapedPage = {
      url,
      finalUrl: `${url}/`,
      links: [
        `${url}/`,
        `${url}/services`,
        `${url}/contact`,
        "tel:+1-512-555-0142",
        "mailto:info@hillcountryplumbing.com",
        "https://www.facebook.com/hillcountryplumbing",
        "https://www.instagram.com/hillcountryplumbing/",
        "https://www.facebook.com/sharer/sharer.php?u=x",
      ],
      markdown:
        "[Home](/) [Services](/services) [Contact us](/contact)\n\n# Family-owned plumbers since 1982\n\n" +
        "Call [(512) 555-0142](tel:+1-512-555-0142) — we answer 24/7.\n\n" +
        "Email [info@hillcountryplumbing.com](mailto:info@hillcountryplumbing.com)\n\n" +
        "[Facebook](https://www.facebook.com/hillcountryplumbing) [Instagram](https://www.instagram.com/hillcountryplumbing/)",
    };

    const fromDirect = extractExternalLinks(direct);
    const fromFirecrawl = extractExternalLinks(firecrawl);
    expect(fromDirect).toEqual(fromFirecrawl);
    expect(fromDirect).toEqual({
      website: "https://www.hillcountryplumbing.com",
      socialLinks: {
        facebook: "https://www.facebook.com/hillcountryplumbing",
        instagram: "https://www.instagram.com/hillcountryplumbing",
      },
      email: "info@hillcountryplumbing.com",
      phone: "+1-512-555-0142",
      contactUrl: "https://www.hillcountryplumbing.com/contact",
    });
  });
});

// ------------------------------------------------------------ html units

describe("html helpers", () => {
  it("decodeEntities handles numeric, hex and named references", () => {
    expect(decodeEntities("A&amp;B &#169; &#xA9; &nbsp;x &rsquo; &unknown; &amp")).toBe("A&B © ©  x ’ &unknown; &");
  });

  it("decodeCfEmail decodes Cloudflare's XOR hex and rejects junk", () => {
    expect(decodeCfEmail(cfEncode("owner@shop.com", 0x13))).toBe("owner@shop.com");
    expect(decodeCfEmail("zz")).toBeNull();
    expect(decodeCfEmail("42")).toBeNull();
    expect(decodeCfEmail(cfEncode("no-at-sign"))).toBeNull();
  });

  it("extractLinks dedupes, entity-decodes hrefs and skips javascript:/data:", () => {
    expect(
      extractLinks(
        `<a href="/a?x=1&amp;y=2">1</a><A HREF="/a?x=1&amp;y=2">2</A><a href="data:text/html,hi">3</a><area href="/map"><a>none</a>`,
        "https://s.com/p/",
      ),
    ).toEqual(["https://s.com/a?x=1&y=2", "https://s.com/map"]);
  });

  it("extractText keeps one block per line and returns null for nothing", () => {
    expect(extractText("<div>One</div><div>Two <b>bold</b></div><br>Three")).toBe("One\nTwo bold\nThree");
    expect(extractText("<script>x</script><style>y</style>")).toBeNull();
  });
});
