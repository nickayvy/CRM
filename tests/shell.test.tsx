// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextRequest } from "next/server";

const nav = vi.hoisted(() => ({ pathname: "/lookup" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { NAV_ITEMS, isActive } from "@/components/shell/nav-items";
import { TopNav } from "@/components/shell/top-nav";
import { shortcutGroups } from "@/components/shell/shortcuts-dialog";
import { HOME_PATH, isPublicPath, safeNextPath, supabaseConfigured } from "@/lib/supabase/config";
import { updateSession } from "@/lib/supabase/middleware";

afterEach(cleanup);

describe("top-bar navigation", () => {
  it("has the five Leadwire items in order", () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ["LOOKUP", "/lookup"],
      ["LEADS", "/leads"],
      ["CALLING", "/calling"],
      ["EMAIL", "/email"],
      ["OVERVIEW", "/overview"],
    ]);
  });

  it("matches nested routes but not prefixes of other words", () => {
    expect(isActive("/calling/abc/dial", "/calling")).toBe(true);
    expect(isActive("/leadsx", "/leads")).toBe(false);
  });

  it("marks the current section active with the muted fill", () => {
    nav.pathname = "/calling/123";
    render(<TopNav />);
    const navEl = screen.getByRole("navigation", { name: "Main" });
    const links = within(navEl).getAllByRole("link");
    expect(links).toHaveLength(5);
    const calling = within(navEl).getByRole("link", { name: /CALLING/ });
    expect(calling.getAttribute("aria-current")).toBe("page");
    expect(calling.className).toContain("bg-muted/60");
    expect(within(navEl).getByRole("link", { name: /LOOKUP/ }).getAttribute("aria-current")).toBeNull();
  });

  it("no longer documents the sidebar shortcut", () => {
    const keys = shortcutGroups("⌘").flatMap((g) => g.items.flatMap((i) => i.keys));
    expect(keys).not.toContain("[");
  });
});

describe("auth path rules", () => {
  it("exempts auth pages, auth API and cron only", () => {
    for (const p of ["/login", "/signup", "/api/auth/callback", "/api/cron/email", "/api/cron/campaigns"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ["/", "/lookup", "/leads", "/design", "/api/search", "/loginx", "/api/authz"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  it("only accepts same-site next paths", () => {
    expect(safeNextPath("/calling/1?x=2")).toBe("/calling/1?x=2");
    expect(safeNextPath(null)).toBe(HOME_PATH);
    expect(safeNextPath("https://evil.example")).toBe(HOME_PATH);
    expect(safeNextPath("//evil.example")).toBe(HOME_PATH);
    expect(safeNextPath("/\\evil.example")).toBe(HOME_PATH);
    expect(safeNextPath("/login")).toBe(HOME_PATH);
  });
});

describe("updateSession without Supabase env (signed out)", () => {
  const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3100"));

  it("runs unconfigured in tests", () => {
    expect(supabaseConfigured()).toBe(false);
  });

  it("redirects pages to /login with a next param", async () => {
    const res = await updateSession(req("/calling/abc?tab=queue"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/calling/abc?tab=queue");
  });

  it("redirects /lookup to plain /login", async () => {
    const res = await updateSession(req("/lookup"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3100/login");
  });

  it("answers protected API routes with 401 JSON", async () => {
    const res = await updateSession(req("/api/search?q=x"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, message: "Unauthorized" });
  });

  it("passes auth pages, auth API and cron through", async () => {
    for (const p of ["/login", "/signup", "/api/auth/callback?code=x", "/api/cron/email"]) {
      const res = await updateSession(req(p));
      expect(res.headers.get("location"), p).toBeNull();
      expect(res.headers.get("x-middleware-next"), p).toBe("1");
    }
  });
});
