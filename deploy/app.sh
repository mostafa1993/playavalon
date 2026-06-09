#!/usr/bin/env bash
#
# deploy/app.sh — manage the GAME app stack (app, traefik, livekit, redis, agent, bots).
# Does NOT touch the Supabase stack — that's deploy/supabase.sh.
#
# Usage:
#   deploy/app.sh            # up -d --build : rebuild (picks up new code) + (re)start  [default]
#   deploy/app.sh restart    # same as default — also --build, so new code is applied
#   deploy/app.sh down       # stop + remove containers (keeps volumes/data)
#   deploy/app.sh ps
#   deploy/app.sh logs
#
# Pull new code first (`git pull`) if you're deploying an update.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-up}" in
  up|restart|build) docker compose up -d --build ;;   # --build => new code is rebuilt automatically
  down)             docker compose down --remove-orphans ;;
  ps)               docker compose ps ;;
  logs)             docker compose logs -f ;;
  *) echo "usage: $0 [up|restart|down|ps|logs]"; exit 2 ;;
esac
