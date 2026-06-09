#!/usr/bin/env bash
#
# deploy/backup-creds.sh — copy the non-reproducible secrets into ~/creds_bkp,
# preserving their repo-relative paths so they drop straight back onto a new VM.
#
# These files are gitignored (so they are NOT in your GitHub backup) and some are
# externally issued (Azure / GCP). Keep a copy OFF this machine.
#
# Run from anywhere; it cd's to the repo root.
set -uo pipefail
cd "$(dirname "$0")/.."

DEST="$HOME/creds_bkp"
mkdir -p "$DEST"
chmod 700 "$DEST"

FILES=(.env supabase/docker/.env secrets/vertex-sa.json livekit.yaml)

echo "Backing up secrets -> $DEST"
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    cp --parents "$f" "$DEST/" && echo "  saved  $f"
  else
    echo "  skip   $f (not found)"
  fi
done

chmod -R go-rwx "$DEST" 2>/dev/null || true

echo ""
echo "Done -> $DEST"
echo "IMPORTANT: this folder holds LIVE secrets. Move/encrypt it OFF this VM"
echo "(password manager, encrypted drive, private vault) — don't leave it sitting here."
