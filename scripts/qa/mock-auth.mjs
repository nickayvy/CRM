// Local stand-in for Supabase Auth, for click-through QA without real accounts:
// any bearer token resolves to one fixed user. The app only talks to it when
// NEXT_PUBLIC_SUPABASE_URL points here (scripts/qa/setup.sh writes that into
// .env.local). Never deployed; see scripts/qa/README.md.
import http from "node:http";
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "demo@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
http
  .createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/auth/v1/user")) return res.end(JSON.stringify(user));
    if (req.url.startsWith("/auth/v1/logout")) { res.statusCode = 204; return res.end(); }
    res.statusCode = 404;
    res.end(JSON.stringify({ msg: "not found", url: req.url }));
  })
  .listen(54399, "127.0.0.1", () => console.log("mock auth on 54399"));
