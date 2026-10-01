#!/usr/bin/env bash
#
# deploy/migrate.sh — apply pending supabase/migrations/*.sql to supabase-db.
#
# Each applied file is recorded in supabase_migrations.schema_migrations, so it
# runs exactly once. Files run as-is, in order; wrap a new migration in
# BEGIN/COMMIT so a failure leaves nothing half-applied. Stops at the first failure.
#
# Usage:
#   deploy/migrate.sh                  # apply pending migrations
#   deploy/migrate.sh --baseline 026   # one-time, for a DB migrated by hand before this
#                                      # script existed: record 001..026 as applied
#                                      # without running them
#
# Run from anywhere; it cd's to the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

sql() { docker exec -i -e PGOPTIONS='-c client_min_messages=warning' supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
record() { sql -c "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$1') ON CONFLICT DO NOTHING"; }

sql -c "CREATE SCHEMA IF NOT EXISTS supabase_migrations;
        CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
          version    text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        );"

if [ "${1:-}" = "--baseline" ]; then
  upto=$((10#${2:?usage: $0 --baseline NNN}))
  for f in $(ls supabase/migrations/*.sql | sort); do
    v=$(basename "$f" .sql)
    [ $((10#${v%%_*})) -le "$upto" ] || continue
    record "$v"
    echo "    baselined $v"
  done
  exit 0
fi

applied=$(sql -c "SELECT version FROM supabase_migrations.schema_migrations")

# A schema with no recorded history was migrated by hand; replaying from 001 would be wrong.
if [ -z "$applied" ] && [ -n "$(sql -c "SELECT to_regclass('public.players')")" ]; then
  echo "ERROR: the database has a schema but no migration history." >&2
  echo "       Record what's already applied, once: $0 --baseline <last applied number>" >&2
  exit 1
fi

for f in $(ls supabase/migrations/*.sql | sort); do
  v=$(basename "$f" .sql)
  grep -qxF "$v" <<<"$applied" && continue
  sql >/dev/null < "$f" || { echo "    FAIL $v" >&2; exit 1; }
  record "$v"
  echo "    applied $v"
done
