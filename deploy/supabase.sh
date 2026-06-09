#!/usr/bin/env bash
#
# deploy/supabase.sh — manage the self-hosted SUPABASE stack
# (db, auth, rest, realtime, kong, studio, meta). Wraps the full -f chain so you
# don't have to remember it. Does NOT touch the game app — that's deploy/app.sh.
#
# Usage:
#   deploy/supabase.sh           # up -d : start / apply any config changes  [default]
#   deploy/supabase.sh restart   # same (up -d) — Supabase uses prebuilt images, nothing to --build
#   deploy/supabase.sh down      # stop + remove containers — KEEPS the database
#   deploy/supabase.sh ps
#   deploy/supabase.sh logs
#
# Safety: this script never passes `-v` to `down`, so it cannot wipe your database.
set -euo pipefail
cd "$(dirname "$0")/.."

SB=(docker compose
    -f supabase/docker/docker-compose.yml
    -f supabase/docker/docker-compose.prod.yml
    -f supabase/docker/docker-compose.studio.yml
    --env-file supabase/docker/.env)

case "${1:-up}" in
  up|restart) "${SB[@]}" up -d ;;
  down)       "${SB[@]}" down ;;       # no -v => database volume preserved
  ps)         "${SB[@]}" ps ;;
  logs)       "${SB[@]}" logs -f ;;
  *) echo "usage: $0 [up|restart|down|ps|logs]"; exit 2 ;;
esac
