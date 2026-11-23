// The session cookie @supabase/ssr reads when the app points at mock-auth.mjs.
// Import { cookieName, cookieValue }, or run it to print "name=value" for curl.
const MOCK_HOST = "127.0.0.1";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 7;

export const user = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "demo@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

// HS256 header: supabase-js then validates the token by asking the (mock) auth server, not a JWKS.
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp })}.c2ln`;
const session = { access_token: jwt, token_type: "bearer", expires_in: exp - now, expires_at: exp, refresh_token: "mock-refresh", user };

/** supabase-js names the cookie after the first label of the project host. */
export const cookieName = `sb-${MOCK_HOST.split(".")[0]}-auth-token`;
export const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

if (process.argv[1]?.endsWith("session-cookie.mjs")) console.log(`${cookieName}=${cookieValue}`);
