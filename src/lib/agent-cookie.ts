import { cookies } from "next/headers";

/** Cookie holding the dialer agent's display name. */
export const AGENT_COOKIE = "crm_agent";
export const AGENT_NAME_MAX = 60;

/** Trims, collapses whitespace and caps length; empty → null. */
export function cleanAgentName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, " ").trim().slice(0, AGENT_NAME_MAX);
  return v || null;
}

/** The agent display name from the request cookie, or null. */
export async function getAgentName(): Promise<string | null> {
  const store = await cookies();
  return cleanAgentName(store.get(AGENT_COOKIE)?.value);
}

/** Sets the agent cookie (Server Actions / Route Handlers only). */
export async function setAgentName(name: string): Promise<void> {
  const clean = cleanAgentName(name);
  const store = await cookies();
  if (!clean) {
    store.delete(AGENT_COOKIE);
    return;
  }
  store.set(AGENT_COOKIE, clean, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}
