#!/usr/bin/env bash
# One command from a clean clone to a running app you can click through
# without real accounts or API keys: mock sign-in, local PGlite, demo data.
# Usage: scripts/qa/setup.sh [--empty]     (--empty skips the demo data)
set -euo pipefail
cd "$(dirname "$0")/../.."

MOCK_URL="http://127.0.0.1:54399"
if curl -s -o /dev/null --max-time 2 http://localhost:3000/login; then
  echo "Something is already serving http://localhost:3000. Stop it first (pkill -f 'next dev'; pkill -f mock-auth.mjs):" >&2
  echo "the embedded database allows only one process at a time." >&2
  exit 1
fi
if [ -f .env.local ] && ! grep -q "$MOCK_URL" .env.local; then
  echo "Refusing to continue: .env.local exists and does not point at the mock auth server." >&2
  echo "Move it aside first; this script must never run against real credentials." >&2
  exit 1
fi
cat > .env.local <<ENV
# Written by scripts/qa/setup.sh: local QA only (mock sign-in, embedded database).
NEXT_PUBLIC_SUPABASE_URL=$MOCK_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=mock-anon-key
PGLITE_DATA_DIR=.data/pglite
APP_TIMEZONE=America/Chicago
ENV
unset DATABASE_URL

[ -d node_modules ] || npm ci --no-audit --no-fund

# PGlite is single-process: migrate and seed before the dev server opens it.
npm run db:migrate
npm run db:seed
if [ "${1:-}" != "--empty" ]; then npx tsx scripts/qa/seed-demo.ts; fi

mkdir -p .data/qa
nohup node scripts/qa/mock-auth.mjs > .data/qa/mock-auth.log 2>&1 &
nohup npm run dev > .data/qa/dev.log 2>&1 &

printf "Waiting for http://localhost:3000 "
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login || true)" = "200" ]; then
    echo " ready."
    echo "Signed-in pages need the cookie from: node scripts/qa/session-cookie.mjs (scripts/qa/browser.mjs sets it for you)."
    exit 0
  fi
  printf "."
  sleep 2
done
echo " the dev server did not come up; see .data/qa/dev.log" >&2
exit 1
