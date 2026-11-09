// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");

// Reference values copied from the gtm app's globals.css `:root` block.
const GTM_TOKENS: Record<string, string> = {
  "--background": "#0a0a0a",
  "--foreground": "#f5f5f5",
  "--card": "#141414",
  "--primary": "#5a8fc9",
  "--secondary": "#1a1a1a",
  "--muted": "#1a1a1a",
  "--muted-foreground": "#9ca3af",
  "--accent": "#262626",
  "--border": "#2a2a2a",
  "--input": "#2a2a2a",
  "--ring": "#5a8fc9",
  "--radius": "0.625rem",
  "--surface": "#0f0f0f",
  "--surface-elevated": "#141414",
  "--shadow-elevated":
    "0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 12px rgba(0, 0, 0, 0.35), 0 12px 28px rgba(0, 0, 0, 0.2)",
  "--shadow-floating":
    "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 10px 28px -4px rgba(0, 0, 0, 0.4), 0 24px 48px -12px rgba(0, 0, 0, 0.5)",
};

const normalise = (value: string) => value.replace(/\s+/g, " ").trim();

/** Body of the first top-level block whose selector is exactly `selector`. */
function extractBlock(source: string, selector: string): string {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = stripped.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  if (start === -1) throw new Error(`no top-level ${selector} block`);
  const open = stripped.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}" && --depth === 0) return stripped.slice(open + 1, i);
  }
  throw new Error(`unterminated ${selector} block`);
}

/** Parse `--name: value;` declarations into a map with normalised values. */
function parse(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = normalise(m[2]);
  return out;
}

describe("Leadwire design tokens match the gtm reference", () => {
  const rootTokens = parse(extractBlock(css, ":root"));
  const darkTokens = parse(extractBlock(css, ".dark"));

  for (const [name, expected] of Object.entries(GTM_TOKENS)) {
    it(`:root ${name}`, () => {
      expect(rootTokens[name]).toBe(normalise(expected));
    });
  }

  it(".dark block is identical to :root", () => {
    expect(darkTokens).toEqual(rootTokens);
  });

  it("detects a mismatch (negative assertions)", () => {
    expect(rootTokens["--primary"]).not.toBe("#000000");
    expect(parse("--primary: #111;")["--primary"]).not.toBe(GTM_TOKENS["--primary"]);
    expect(parse(":root { --a: 1px;\n --b:   2   3; }")["--b"]).toBe("2 3");
  });
});

describe("root layout and font wiring", () => {
  it("loads Space_Grotesk and Source_Serif_4 from next/font/google with the right variables", () => {
    expect(layout).toMatch(
      /import\s*\{[^}]*\bSpace_Grotesk\b[^}]*\}\s*from\s*["']next\/font\/google["']/,
    );
    expect(layout).toMatch(
      /import\s*\{[^}]*\bSource_Serif_4\b[^}]*\}\s*from\s*["']next\/font\/google["']/,
    );
    expect(layout).toMatch(/Space_Grotesk\(\s*\{[^}]*variable:\s*["']--font-space-grotesk["']/);
    expect(layout).toMatch(/Source_Serif_4\(\s*\{[^}]*variable:\s*["']--font-serif-display["']/);
  });

  it("forces dark on <html> and does not use next-themes", () => {
    expect(layout).toMatch(/<html[^>]*className=\{?[`"'][^>]*\bdark\b/);
    expect(layout).not.toMatch(/next-themes/);
  });

  it("maps --font-sans and --font-serif to the font variables in globals.css", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-space-grotesk\)/);
    expect(css).toMatch(/--font-serif:\s*var\(--font-serif-display\)/);
  });
});
