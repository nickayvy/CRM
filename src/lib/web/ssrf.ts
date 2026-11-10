// SSRF guard for server-side fetches of URLs that came from third-party data
// (business websites). A URL is allowed only when it is plain http(s) on the
// default ports, carries no credentials, does not name an internal host, and
// every address its host resolves to is a public unicast address. Applied to
// the first URL and to every redirect target, before any connection is made.
// See docs/team/links/architecture.md §Direct fetch.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** The URL (or an address it resolves to) must not be fetched. Final: never retried elsewhere. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Resolves a hostname to every address it has (IPv4 and IPv6). */
export type Lookup = (host: string) => Promise<string[]>;

/** System resolver (getaddrinfo), every address, in resolver order. */
export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];

// ------------------------------------------------------------ addresses

function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Why an IPv4 address is refused, or null when it is public unicast. */
function ipv4Refusal(o: number[]): string | null {
  const [a, b, c] = o;
  if (a === 0) return "unspecified/this-network";
  if (a === 10) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking";
  if (a === 198 && b === 51 && c === 100) return "documentation";
  if (a === 203 && b === 0 && c === 113) return "documentation";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved/broadcast";
  return null;
}

/** "fe80::1%eth0" / "::ffff:1.2.3.4" → eight 16-bit groups, or null. */
function parseIPv6(raw: string): number[] | null {
  let s = raw.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // Trailing dotted IPv4 ("::ffff:1.2.3.4") becomes two groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out.length === 8 ? out : null;
}

const v4From = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];

/** Why an IPv6 address is refused, or null when it is public unicast. */
function ipv6Refusal(g: number[]): string | null {
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(8)) return "unspecified";
  if (zeroUpTo(7) && g[7] === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 address.
  if (zeroUpTo(5) && g[5] === 0xffff) return ipv4Refusal(v4From(g[6], g[7])) ?? null;
  if (zeroUpTo(6)) return ipv4Refusal(v4From(g[6], g[7])) ?? "IPv4-compatible";
  // NAT64 (64:ff9b::/96) reaches the embedded IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return ipv4Refusal(v4From(g[6], g[7]));
  // 6to4 (2002::/16) embeds an IPv4 address in groups 1–2.
  if (g[0] === 0x2002) return ipv4Refusal(v4From(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return "unique-local";
  if ((g[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((g[0] & 0xffc0) === 0xfec0) return "site-local";
  if ((g[0] & 0xff00) === 0xff00) return "multicast";
  if (g[0] === 0x2001 && g[1] === 0x0db8) return "documentation";
  if (g[0] === 0x0100 && zeroUpTo(4)) return "discard";
  return null;
}

/**
 * Why `ip` must not be connected to ("loopback", "private", …), or null for a
 * public unicast address. Anything that does not parse as an IP is refused.
 */
export function addressRefusal(ip: string): string | null {
  const kind = isIP(ip.replace(/%.*$/, ""));
  if (kind === 4) return ipv4Refusal(parseIPv4(ip)!);
  if (kind === 6) {
    const g = parseIPv6(ip);
    return g ? ipv6Refusal(g) : "unparsable";
  }
  return "not an IP address";
}

// ------------------------------------------------------------ URLs

/** Hostname as the resolver sees it: no IPv6 brackets, no trailing dot, lower case. */
export function bareHostname(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** Throws UnsafeUrlError when the URL itself (before DNS) is not allowed. */
export function assertSafeUrlShape(u: URL): void {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError(`refused ${u.protocol} URL`);
  if (u.username || u.password) throw new UnsafeUrlError("refused URL with credentials");
  if (u.port !== "" && u.port !== "80" && u.port !== "443") throw new UnsafeUrlError(`refused port ${u.port}`);
  const host = bareHostname(u);
  if (!host) throw new UnsafeUrlError("refused URL without a host");
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError(`refused internal host ${host}`);
  }
}

/** Throws UnsafeUrlError when any of `addresses` (or none at all) is not public. */
export function assertPublicAddresses(host: string, addresses: readonly string[]): void {
  if (addresses.length === 0) throw new Error(`${host} did not resolve`);
  for (const a of addresses) {
    const why = addressRefusal(a);
    if (why) throw new UnsafeUrlError(`refused ${host}: ${a} is ${why}`);
  }
}

/**
 * Full check for one hop: URL shape, then the host's addresses (a literal IP
 * is checked as is; a name through `lookup`, and every answer must be
 * public). Resolves with the vetted addresses. Throws UnsafeUrlError when
 * refused; a resolver failure rejects with the resolver's own error.
 */
export async function assertSafeUrl(u: URL, lookup: Lookup = systemLookup): Promise<string[]> {
  assertSafeUrlShape(u);
  const host = bareHostname(u);
  const addresses = isIP(host) ? [host] : await lookup(host);
  assertPublicAddresses(host, addresses);
  return addresses;
}
