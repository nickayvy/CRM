// A minimal `fetch` over node:http/https whose socket connects only to
// addresses that passed the SSRF check. The check runs inside the socket's own
// DNS lookup, so the address that is checked is the address that is connected
// to: a hostname cannot answer "public" to a pre-check and "private" to the
// connection (DNS rebinding). Only what fetchPage needs: GET-style requests,
// manual redirects, gzip/deflate/br bodies, AbortSignal.
import http from "node:http";
import https from "node:https";
import type { LookupAddress, LookupOptions } from "node:dns";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { type Lookup, UnsafeUrlError, addressRefusal, systemLookup } from "./ssrf";

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `resolve` answers the socket's DNS query (default: the system resolver).
 * `allow` decides whether an address may be connected to (default: public
 * unicast only, see `addressRefusal`); tests pass a looser one to reach a
 * local server.
 */
export function createPinnedFetch(opts: { resolve?: Lookup; allow?: (ip: string) => boolean } = {}): typeof fetch {
  const resolve = opts.resolve ?? systemLookup;
  const allow = opts.allow ?? ((ip: string) => addressRefusal(ip) === null);

  const lookup = (hostname: string, options: LookupOptions, callback: LookupCallback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(Object.assign(new Error(`${hostname} did not resolve`), { code: "ENOTFOUND" }), []);
        const bad = addresses.find((a) => !allow(a));
        if (bad) return callback(new UnsafeUrlError(`refused ${hostname}: ${bad} is not a public address`), []);
        const family = (a: string) => (a.includes(":") ? 6 : 4);
        const wanted = options.family === 4 || options.family === 6 ? addresses.filter((a) => family(a) === options.family) : addresses;
        if (wanted.length === 0) return callback(Object.assign(new Error(`${hostname} has no IPv${options.family} address`), { code: "ENOTFOUND" }), []);
        if (options.all) return callback(null, wanted.map((address) => ({ address, family: family(address) })));
        callback(null, wanted[0], family(wanted[0]));
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, []),
    );
  };

  const pinnedFetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
    new Promise<Response>((resolvePromise, reject) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const mod = url.protocol === "https:" ? https : url.protocol === "http:" ? http : null;
      if (!mod) return reject(new UnsafeUrlError(`refused ${url.protocol} URL`));
      // A literal IP never goes through `lookup`: check it here.
      const literal = url.hostname.replace(/^\[|\]$/g, "");
      if (/^[\d.]+$|:/.test(literal) && !allow(literal)) {
        return reject(new UnsafeUrlError(`refused ${literal}: not a public address`));
      }
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      const req = mod.request(url, {
        method: init.method ?? "GET",
        headers,
        lookup: lookup as never,
        signal: init.signal ?? undefined,
        agent: false,
      });
      req.on("error", reject);
      req.on("response", (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
          else if (v !== undefined) h.set(k, v);
        }
        const status = res.statusCode ?? 0;
        const encoding = (res.headers["content-encoding"] ?? "").toString().trim().toLowerCase();
        const decoder =
          encoding === "gzip" || encoding === "x-gzip"
            ? zlib.createGunzip()
            : encoding === "deflate"
              ? zlib.createInflate()
              : encoding === "br"
                ? zlib.createBrotliDecompress()
                : null;
        const stream: Readable = decoder ? res.pipe(decoder) : res;
        if (decoder) res.on("error", (e) => decoder.destroy(e));
        if (decoder) h.delete("content-encoding");
        const nullBody = status === 204 || status === 304 || (status >= 100 && status < 200) || init.method === "HEAD";
        if (nullBody) res.resume();
        resolvePromise(
          new Response(nullBody ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>), {
            status: status >= 200 && status <= 599 ? status : 502,
            statusText: res.statusMessage,
            headers: h,
          }),
        );
      });
      req.end();
    });
  return pinnedFetch as typeof fetch;
}
