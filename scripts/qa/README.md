# Local QA harness

Runs the app end to end on one machine with no real accounts and no API
keys, so every screen can be clicked through by a person or a script.
Nothing here is used by the deployed app.

```bash
scripts/qa/setup.sh            # mock sign-in + PGlite + demo data + dev server on :3000
scripts/qa/setup.sh --empty    # the same with an empty database (first-run screens)
node scripts/qa/browser.mjs /tmp/shots 1440 /overview /leads   # full-page screenshots
```

| File | What it does |
|---|---|
| `setup.sh` | Writes a mock-only `.env.local`, migrates and seeds the local PGlite, starts the mock auth server and `next dev`. Refuses to run when a real `.env.local` is present. |
| `mock-auth.mjs` | Stand-in for Supabase Auth on `127.0.0.1:54399`: every token is the user `demo@example.test`. |
| `session-cookie.mjs` | The session cookie that signs a browser (or `curl -H "Cookie: …"`) in against the mock. |
| `seed-demo.ts` | Demo data: 140 businesses, 38 leads, call and email campaigns in every state, a week of calls, due callbacks. Refuses to run when `DATABASE_URL` is set. |
| `browser.mjs` | `openSignedIn()` and `shoot()` for Playwright scripts, plus the screenshot CLI above. |

Limits: Google Maps, Yelp, Trustpilot discovery, AI calling and real email
need their keys, so those screens show their "not configured" or dry-run
states. To start over, stop the two servers (`pkill -f "next dev"; pkill -f
mock-auth.mjs`) and delete `.data/`.
