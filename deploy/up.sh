#!/usr/bin/env bash
#
# deploy/up.sh — bring up the full self-hosted playavalon stack on a VM, in order:
#
#     shared network  ->  Supabase stack  ->  migrations (fresh DB only)  ->  app
#
# Safe to re-run: migrations are applied ONLY when the DB is empty, so it never
# re-runs the data-truncating auth migration (021) on a populated database.
#
# For a normal app update you do NOT need this — just `docker compose up -d --build`.
# This is the from-scratch / new-VM bring-up (see docs/deploy-from-scratch.md).
#
# Run from anywhere; it cd's to the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

# --- prechecks ---------------------------------------------------------------
[ -f supabase/docker/.env ] || { echo "ERROR: supabase/docker/.env missing — run: node supabase/docker/generate-keys.mjs --prod"; exit 1; }
[ -f .env ]                 || { echo "ERROR: .env (app) missing — create it (see docs/deploy-from-scratch.md)"; exit 1; }

SB=(docker compose
    -f supabase/docker/docker-compose.yml
    -f supabase/docker/docker-compose.prod.yml
    -f supabase/docker/docker-compose.studio.yml
    --env-file supabase/docker/.env)

regclass() { docker exec supabase-db psql -U postgres -d postgres -tAc "select to_regclass('$1');" 2>/dev/null | tr -d '[:space:]'; }

echo "==> 1/4  shared network"
docker network create avalon-shared 2>/dev/null && echo "    created avalon-shared" || echo "    avalon-shared already exists"

echo "==> 2/4  Supabase stack"
"${SB[@]}" up -d
echo "    waiting for db..."
for _ in $(seq 1 30); do docker exec supabase-db pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done

echo "==> 3/4  migrations (fresh DB only)"
if [ -z "$(regclass public.players)" ]; then
  echo "    fresh DB — waiting for the auth schema, then applying migrations"
  for _ in $(seq 1 30); do [ "$(regclass auth.users)" = "auth.users" ] && break; sleep 2; done
  for f in $(ls supabase/migrations/*.sql | sort); do
    docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" \
      && echo "    OK $(basename "$f")" \
      || { echo "    FAIL $(basename "$f")"; exit 1; }
  done
else
  echo "    schema already present — skipping migrations (protects existing data)"
fi

echo "==> 4/4  app"
docker compose up -d --build

echo ""
echo "Done."
echo "  App:       https://playavalon.fun"
echo "  Dashboard: https://supabase.playavalon.fun   (user 'supabase', pwd via: grep DASHBOARD supabase/docker/.env)"
