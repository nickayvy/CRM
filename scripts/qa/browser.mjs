// Playwright helpers for QA scripts: a signed-in page, and full-page screenshots.
//
//   import { openSignedIn, shoot } from "./scripts/qa/browser.mjs";
//   const { browser, page, errors } = await openSignedIn({ width: 390 });
//   await page.goto(BASE + "/leads"); ... await browser.close();
//
// As a CLI:  node scripts/qa/browser.mjs <outdir> <width> <path>[=name] ...
//
// Playwright is not a project dependency; it is resolved from the machine
// (global install / NODE_PATH), as on the cloud dev containers.
import { createRequire } from "node:module";
import { cookieName, cookieValue } from "./session-cookie.mjs";

export const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";

/** A browser page carrying the mock session. `errors` collects console errors and uncaught exceptions. */
export async function openSignedIn({ width = 1440, height = 900, signedIn = true, deviceScaleFactor = 1 } = {}) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor });
  if (signedIn) await context.addCookies([{ name: cookieName, value: cookieValue, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 400)));
  page.on("pageerror", (e) => errors.push(`uncaught: ${String(e).slice(0, 400)}`));
  return { browser, context, page, errors };
}

/**
 * Full-page screenshot. The app scrolls inside <main>, so the shell is
 * unclipped first; do this last on a page, it changes the layout.
 */
export async function shoot(page, file) {
  await page.addStyleTag({
    content: `[data-slot="app-shell"]{height:auto!important;overflow:visible!important} main#main{overflow:visible!important}`,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: true });
}

if (process.argv[1]?.endsWith("browser.mjs")) {
  const [outdir, width, ...paths] = process.argv.slice(2);
  if (!outdir || !width || paths.length === 0) {
    console.error("usage: node scripts/qa/browser.mjs <outdir> <width> <path>[=name] ...");
    process.exit(1);
  }
  const { browser, page, errors } = await openSignedIn({ width: Number(width) });
  for (const p of paths) {
    const [path, name] = p.split("=");
    const file = `${outdir}/${name ?? (path.replace(/^\//, "").replace(/[/?=&]/g, "_") || "root")}-${width}.png`;
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 }).catch((e) => errors.push(`${path}: ${e.message.slice(0, 160)}`));
    await page.waitForTimeout(1500);
    await shoot(page, file);
    console.log(`${path} -> ${file} (ended at ${page.url().replace(BASE, "")})`);
  }
  if (errors.length) console.log("Console errors:\n" + [...new Set(errors)].join("\n"));
  await browser.close();
}
