#!/usr/bin/env bash
#
# deploy/app.sh — manage the GAME app stack (app, traefik, livekit, redis, reviewer, bot-supervisor).
# Does NOT touch the Supabase stack — that's deploy/supabase.sh.
#
# Usage:
#   deploy/app.sh            # down --remove-orphans, then up -d --build (rebuild + start)  [default]
#   deploy/app.sh restart    # same as default — also --build, so new code is applied
#   deploy/app.sh down       # stop + remove containers (keeps volumes/data)
#   deploy/app.sh ps
#   deploy/app.sh logs
#
# Pull new code first (`git pull`) if you're deploying an update.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-up}" in
  up|restart|build) docker compose down --remove-orphans && docker compose up -d --build ;;  # clean slate (drops orphans), then rebuild + start
  down)             docker compose down --remove-orphans ;;
  ps)               docker compose ps ;;
  logs)             docker compose logs -f ;;
  *) echo "usage: $0 [up|restart|down|ps|logs]"; exit 2 ;;
esac
