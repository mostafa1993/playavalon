# Deploy from scratch on a new VM (fresh, empty DB)

A clean install — **no data migration**; players re-register. ~15 minutes.
(To instead bring accounts/history from another instance, see the data-migration
runbook in [`self-host-supabase-plan.md`](self-host-supabase-plan.md) §8.)

## The one thing to back up

Everything reproducible lives in git (code, compose, migrations) and the DB
starts empty — so the **only** non-reproducible pieces are secrets. Keep a safe
backup of these from a working VM, or be ready to recreate them:

- **`.env`** (repo root) — especially the LiveKit / Azure / GCP / ACME values
- **`secrets/vertex-sa.json`** — GCP service account, for the AI reviewer (optional)
- **`livekit.yaml`** — LiveKit prod config (if you use voice)

`supabase/docker/.env` is **generated fresh** each time, not backed up.

> **Just run `./deploy/backup-creds.sh`** on the live VM — it copies the files
> above into `~/creds_bkp/` (preserving paths). Then move/encrypt that folder
> somewhere off the VM.

---

## Steps

### 0. VM + DNS
- A VM with Docker + Docker Compose installed; firewall open on **80** and **443**.
- DNS A-records pointing at the VM's IP:
  - `playavalon.fun`
  - `supabase.playavalon.fun`
  - `livekit.playavalon.fun` (only if using voice)

### 1. Get the code
```bash
git clone git@github.com:mostafa1993/playavalon.git
cd playavalon
git checkout main        # or the branch you deploy
```

### 2. Generate the Supabase stack secrets
```bash
node supabase/docker/generate-keys.mjs --prod
# No Node on the host? run it in a container:
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/work -w /work node:20-slim \
  node supabase/docker/generate-keys.mjs --prod
```
Writes `supabase/docker/.env` (DB password, JWT secret, anon/service keys, dashboard
password) and **prints** the three app-side lines for the next step.

### 3. Create the app `.env` (repo root)
Restore from backup, or start from `.env.example` and fill in. Required keys:
```dotenv
COMPOSE_PROFILES=prod
ENV_FILE=.env
ACME_EMAIL=you@example.com
# from step 2's printout:
NEXT_PUBLIC_SUPABASE_URL=https://supabase.playavalon.fun
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from step 2>
SUPABASE_SERVICE_ROLE_KEY=<from step 2>
# LiveKit (any matching key/secret pair; must also match livekit.yaml):
LIVEKIT_URL=wss://livekit.playavalon.fun
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
LIVEKIT_CONFIG=./livekit.yaml
CLEANUP_API_KEY=<any random string>
# AI reviewer (OPTIONAL — game works without it):
# AZURE_SPEECH_KEY=...   GCP_PROJECT_ID=...   GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/vertex-sa.json
```
Also drop in the secret files referenced above: `secrets/vertex-sa.json`, `livekit.yaml`.

> **Shortcut:** once steps 0–3 are done, run **`./deploy/up.sh`** to do steps 4–6
> (network → Supabase + migrations → app) in one go. It only applies migrations
> to a fresh DB, so it's safe to re-run. The manual steps below are the same thing.

### 4. Create the shared network (once)
```bash
docker network create avalon-shared
```

### 5. Bring up Supabase + apply migrations
```bash
docker compose -f supabase/docker/docker-compose.yml \
               -f supabase/docker/docker-compose.prod.yml \
               -f supabase/docker/docker-compose.studio.yml \
               --env-file supabase/docker/.env up -d

# wait until containers are healthy, then apply the schema:
for f in $(ls supabase/migrations/*.sql | sort); do \
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" \
  && echo "OK $(basename $f)" || { echo "FAIL $(basename $f)"; break; }; done
```

### 6. Bring up the app
```bash
docker compose up -d --build
```
(`COMPOSE_PROFILES=prod` + `ENV_FILE=.env` come from `.env`, so plain `docker compose` is enough.)

### 7. Verify
- **https://playavalon.fun** → register an account → create a room.
- **Dashboard:** https://supabase.playavalon.fun → `supabase` / the `DASHBOARD_PASSWORD`
  in `supabase/docker/.env` (`grep DASHBOARD supabase/docker/.env`).

---

## Notes
- **Order matters:** network → Supabase + migrations → app. The app errors on boot if
  `avalon-shared` doesn't exist or Supabase isn't reachable yet.
- **Fresh DB = empty.** No accounts/history; everyone re-registers (frictionless since
  email confirmation is off).
- **AI reviewer** (the `agent` service, Azure + GCP) is optional — skip those envs and
  the game runs fine; only post-game AI summaries are disabled.
- **GCP can't hairpin its own public IP** — the `supabase.playavalon.fun -> host-gateway`
  mapping in `docker-compose.yml` handles that (already in the repo, nothing to do).
