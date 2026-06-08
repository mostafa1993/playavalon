# Self-hosted Supabase stack

Trimmed Supabase stack that replaces cloud Supabase for playavalon. See the full
plan at [`docs/self-host-supabase-plan.md`](../../docs/self-host-supabase-plan.md).

**Services:** `db` (Postgres) · `auth` (GoTrue) · `rest` (PostgREST) · `realtime` · `kong` (API gateway)
**Dropped from upstream:** studio, meta, storage, imgproxy, functions, supavisor.

Volume files under `volumes/` are vendored unchanged from the official
`supabase/docker` reference.

## Local testing

```bash
# 1. Generate secrets + keys (writes ./.env, once)
node supabase/docker/generate-keys.mjs

# 2. Boot the stack
docker compose -f supabase/docker/docker-compose.yml up -d

# 3. Apply the app schema (after auth is healthy, so the auth schema exists)
#    See scripts/apply-migrations.sh

# 4. Point the app at it (.env.local), then `npm run dev`:
#    NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=<printed by generate-keys.mjs>
#    SUPABASE_SERVICE_ROLE_KEY=<printed by generate-keys.mjs>
```

- **API gateway (Kong):** http://localhost:8000  (`/auth/v1`, `/rest/v1`, `/realtime/v1`)
- **Postgres (direct):** `postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres`

## Stop / reset

```bash
docker compose -f supabase/docker/docker-compose.yml down          # stop
docker compose -f supabase/docker/docker-compose.yml down -v       # stop + WIPE the database
```

## Notes

- `.env` is gitignored (contains secrets). Commit only `.env.example`.
- The anon/service keys are HS256 JWTs signed with `JWT_SECRET`. Rotating
  `JWT_SECRET` invalidates all sessions and the app-baked anon key — to rotate,
  delete `.env` and re-run the generator, then rebuild the app image.
- For the VM deploy, change the URL block in `.env` to the public subdomain and
  front Kong with the existing Traefik (Phase 4 of the plan).
