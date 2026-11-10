// Pure HTML → ScrapedPage pieces for the direct fetch: every <a>/<area> href
// resolved to absolute (mailto:/tel: kept), visible text with scripts and
// styles removed, and Cloudflare-obfuscated emails decoded. Regex based, on
// purpose: no parser dependency, and the consumer (extractExternalLinks) only
// needs hrefs and loose text.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•",
  middot: "·", laquo: "«", raquo: "»", deg: "°", times: "×", euro: "€", pound: "£", cent: "¢",
  sect: "§", para: "¶", shy: "", zwnj: "", zwj: "", commat: "@", period: ".", colon: ":", sol: "/",
  num: "#", dollar: "$", percnt: "%", lpar: "(", rpar: ")", plus: "+", comma: ",", hyphen: "-",
};

/** Decodes numeric and the common named character references; unknown ones stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined && (m.endsWith(";") || body.length <= 4) ? named : m;
  });
}

/**
 * Cloudflare email protection: hex string whose first byte is the XOR key for
 * the rest (UTF-8 bytes of the address). Null when malformed.
 */
export function decodeCfEmail(hex: string): string | null {
  const h = hex.trim();
  if (!/^[0-9a-f]+$/i.test(h) || h.length < 4 || h.length % 2 !== 0) return null;
  const key = parseInt(h.slice(0, 2), 16);
  const bytes: number[] = [];
  for (let i = 2; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16) ^ key);
  const out = Buffer.from(bytes).toString("utf8");
  return out.includes("@") && !/[\s<>"]/.test(out) ? out : null;
}

const CF_PATH_RE = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i;

/** Attribute value of `name` inside one tag's source, entity-decoded; null when absent. */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`[\\s"'/]${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

/** Removes comments and the bodies of elements that never render as text. */
function stripInvisible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(-->|$)/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*$/gi, " "); // unterminated (truncated body)
}

/** The document's <base href>, resolved against `pageUrl`, else `pageUrl`. */
function baseUrl(html: string, pageUrl: string): string {
  const tag = /<base\b[^>]*>/i.exec(html)?.[0];
  const href = tag ? attr(tag, "href") : null;
  if (href) {
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    } catch {
      // fall through
    }
  }
  return pageUrl;
}

/**
 * Every <a>/<area> href, resolved to an absolute URL, in page order without
 * duplicates. mailto:/tel: are kept; javascript:/data:/bare fragments are
 * dropped. Cloudflare-protected addresses (an /cdn-cgi/l/email-protection#…
 * href, or any element carrying data-cfemail) come out as `mailto:` links.
 */
export function extractLinks(html: string, pageUrl: string): string[] {
  const doc = stripInvisible(html);
  const base = baseUrl(doc, pageUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };

  for (const m of doc.matchAll(/<[a-z][a-z0-9-]*\b[^>]*>/gi)) {
    const tag = m[0];
    const cf = attr(tag, "data-cfemail");
    if (cf) {
      const email = decodeCfEmail(cf);
      if (email) push(`mailto:${email}`);
    }
    if (!/^<(a|area)\b/i.test(tag)) continue;
    const href = attr(tag, "href")?.trim();
    if (!href || href.startsWith("#")) continue;
    if (/\/cdn-cgi\/l\/email-protection/i.test(href)) {
      const cfPath = CF_PATH_RE.exec(href);
      const email = cfPath ? decodeCfEmail(cfPath[1]) : null;
      if (email) push(`mailto:${email}`);
      continue;
    }
    if (/^(javascript|data|vbscript|about|blob):/i.test(href)) continue;
    if (/^(mailto|tel|sms):/i.test(href)) {
      push(href.replace(/\s+/g, ""));
      continue;
    }
    try {
      const u = new URL(href, base);
      if (u.protocol === "http:" || u.protocol === "https:") push(u.toString());
    } catch {
      // unparsable href: skip
    }
  }
  return out;
}

const BLOCK_TAGS =
  "address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|title|tr|ul";

/**
 * Visible text, one block per line: invisible elements removed, Cloudflare
 * email placeholders replaced by the decoded address, tags stripped, entities
 * decoded, whitespace collapsed. Null when nothing is left.
 */
export function extractText(html: string): string | null {
  let doc = stripInvisible(html);
  // "[email protected]" placeholders: put the real address where it was shown.
  doc = doc.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-cfemail\s*=[^>]*)>[\s\S]*?<\/\1\s*>/gi, (m, _t, attrs: string) => {
    const email = decodeCfEmail(attr(` ${attrs}`, "data-cfemail") ?? "");
    return email ? ` ${email} ` : m;
  });
  doc = doc
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/, " ");
  const text = decodeEntities(doc)
    .split("\n")
    .map((line) => line.replace(/[\s ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text === "" ? null : text;
}

/** Charset from a Content-Type header or the document's <meta>, else null. */
export function charsetOf(contentType: string | null, head: Uint8Array): string | null {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = Buffer.from(head.subarray(0, 4096)).toString("latin1");
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(ascii)?.[1];
  return meta ? meta.toLowerCase() : null;
}

/** Decodes body bytes with `charset`, falling back to UTF-8 for unknown labels. */
export function decodeBody(bytes: Uint8Array, charset: string | null): string {
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
