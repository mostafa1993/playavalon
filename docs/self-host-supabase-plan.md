# Self-Hosting Supabase — Implementation Plan & Runbook

**Branch:** `feat/self-host-supabase`
**Goal:** Eliminate metered Supabase egress by running the full Supabase stack on our own VM, keeping all application code unchanged, and migrating existing data across.
**Status:** 🟡 Planning complete — implementation not started.

---

## 1. Why we're doing this

### The problem
The cloud Supabase project is over its Free-plan **egress** quota:

| Metric | Value | Note |
|---|---|---|
| Egress (used) | **10.49 GB** / 5 GB | The problem — 210% of quota |
| Database size | 31 MB | Data is tiny |
| Realtime messages | 10,074 / 2M | Negligible |
| Storage | 0 | Unused |
| MAU | 26 | ≈ **400 MB egress per user/month** |

Grace period ends **2026-07-02**; after that the Fair-Use Policy applies and requests may return HTTP 402 (throttled/blocked). We don't want to pay for Supabase Pro ($25/mo).

### Root cause (diagnosed, not guessed)
400 MB/user for a turn-based game = **redundant polling**, not game data:
- Browsers re-pull full game state every **3s** (`useGameState.ts`, `useRoom.ts`, watcher state).
- AI bots poll every **2s** (`agents/src/config/schema.ts`), one process per bot seat.
- Every poll → Next.js API route → a **read from cloud Supabase over the internet** → metered egress.

### Why self-hosting fixes it
When Postgres/Auth/Realtime live on the **same VM** as the app, those reads travel over the Docker network = **unmetered and free**, and scale for free as we grow. The browser↔Supabase legs (Auth + Realtime) move to the VM's own bandwidth allowance, which is plentiful at our scale (~10 friends, once a week).

---

## 2. Strategy: self-host *Supabase*, not vanilla Postgres

We run the **open-source Supabase stack** (Postgres + GoTrue + PostgREST + Realtime + Kong) in Docker, not a bare Postgres with hand-rolled auth.

**Why this and not a full rewrite to plain Postgres:**
- Our 24 migrations reference Supabase-isms — `auth.users`, `auth.uid()`, RLS, `SECURITY DEFINER`, and the `anon`/`authenticated`/`service_role` roles. **All of these exist in self-hosted Supabase**, so the migrations apply unchanged.
- `@supabase/supabase-js`, `@supabase/ssr`, our Auth flow, RLS policies, and the Realtime broadcast channels all keep working — we only change a URL and keys.
- We just built Supabase Auth in migration `021`. A vanilla-Postgres path would throw that away and force an auth rewrite (the most security-sensitive code in the app). Not worth it to dodge a $25 bill.

### Non-goals (explicitly out of scope)
- **High availability / no single point of failure** — accepted risk. If the VM dies, worst case we rebuild from this runbook + the last DB dump.
- **Automated backups / PITR** — not required for 10 friends playing weekly. (A manual `pg_dump` before risky operations is enough.)
- Migrating Storage / Edge Functions — we use neither.

---

## 3. Architecture

### Before
```
Browser ──TLS──► Traefik ──► Next.js app ──internet egress──► cloud Supabase (DB/Auth/Realtime)
Browser ───────────────────────────────────internet─────────► cloud Supabase (Auth + Realtime WS)
Bots ──► app (docker net) ──internet egress──► cloud Supabase
```
Every DB read crosses the metered internet boundary.

### After
```
Browser ──TLS──► Traefik ──► supabase.playavalon.fun ──► Kong ──► auth/rest/realtime ──► Postgres   (all on VM)
Browser ──TLS──► Traefik ──► playavalon.fun ──► Next.js app ──docker net──► Kong ──► Postgres        (all on VM)
Bots ──► app (docker net) ──► Kong (docker net) ──► Postgres                                          (all on VM)
```
Nothing leaves the VM except browser↔VM traffic (on the VM's own bandwidth, not metered per-GB).

### Public vs internal access
- **Browser** needs a public HTTPS endpoint for its own Auth + Realtime websocket connections → new subdomain **`supabase.playavalon.fun`**, TLS-terminated by our existing Traefik, forwarded to `kong:8000`.
- **App + bots** (inside Docker) reach Supabase over the internal network. Either the public URL (hairpins through Traefik on the same box — still free, slight TLS overhead) or, as an optional refinement, an internal `http://kong:8000` URL to skip the hairpin.

---

## 4. The trimmed stack

Based on the official `supabase/docker` compose, keep only what we use:

| Service | Image (pin at implementation) | Keep? | Role |
|---|---|---|---|
| `db` | `supabase/postgres` | ✅ | Database (ships with `anon`/`authenticated`/`service_role` roles, `auth` schema support) |
| `auth` | `supabase/gotrue` | ✅ | Powers `supabase.auth.*` |
| `rest` | `postgrest/postgrest` | ✅ | Powers `.from().select()` |
| `realtime` | `supabase/realtime` | ✅ | Powers broadcast channels |
| `kong` | `kong` | ✅ | API gateway: routes `/auth/v1`, `/rest/v1`, `/realtime/v1` under one origin |
| `studio` + `meta` | `supabase/studio`, `supabase/postgres-meta` | ⚪ Optional | Admin dashboard (nice for debugging; not required) |
| `storage`, `imgproxy` | — | ❌ Drop | Storage unused |
| `functions` (edge-runtime) | — | ❌ Drop | Edge Functions unused |
| `analytics` (logflare) | — | ❌ Drop | Heavy; the usual boot-breaker. Remove its `depends_on` references too. |
| `vector` | — | ❌ Drop | Log shipping unused |
| `supavisor` | — | ❌ Drop | Connection pooler not needed at our scale |

**Resource estimate:** ~1–2 GB RAM total. VM has **13 GiB available** → ample headroom.

**Integration:** add these services to the existing `docker-compose.yml`, mirroring the `redis`/`livekit` pattern. Local-test mode exposes Kong on `localhost:8000`; prod mode routes via Traefik.

---

## 5. Keys & secrets

Generate once, store in `.env` (prod) / `.env.local` (local test):
- **`JWT_SECRET`** — long random string. The root of trust.
- **`ANON_KEY`** — a JWT signed with `JWT_SECRET`, role claim `anon`, long expiry. → becomes `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **`SERVICE_ROLE_KEY`** — a JWT signed with `JWT_SECRET`, role claim `service_role`. → becomes `SUPABASE_SERVICE_ROLE_KEY`.
- **`POSTGRES_PASSWORD`** — DB superuser password.
- **Realtime secrets** — `SECRET_KEY_BASE`, `DB_ENC_KEY`, `API_JWT_SECRET` (= `JWT_SECRET`).

The anon/service keys are generated *from* `JWT_SECRET` using Supabase's published key generator (or by signing the standard payloads). I'll produce them during implementation.

### GoTrue (auth) config — important
- **`GOTRUE_MAILER_AUTOCONFIRM=true`** → no email confirmation, **no SMTP server needed** (matches current setup).
- `GOTRUE_JWT_SECRET=$JWT_SECRET`
- `GOTRUE_SITE_URL=https://playavalon.fun`
- Email/password sign-up only (no external OAuth) — matches today.

---

## 6. Environment variables — and the build-time gotcha

### What changes in `.env` at cutover
```diff
- NEXT_PUBLIC_SUPABASE_URL=https://<cloud-id>.supabase.co
+ NEXT_PUBLIC_SUPABASE_URL=https://supabase.playavalon.fun
- NEXT_PUBLIC_SUPABASE_ANON_KEY=<cloud anon key>
+ NEXT_PUBLIC_SUPABASE_ANON_KEY=<new anon key from JWT_SECRET>
- SUPABASE_SERVICE_ROLE_KEY=<cloud service key>
+ SUPABASE_SERVICE_ROLE_KEY=<new service key from JWT_SECRET>
+ JWT_SECRET=<...>
+ POSTGRES_PASSWORD=<...>
+ (realtime secrets…)
```

### ⚠️ Build-time baking — do not get caught by this
`NEXT_PUBLIC_*` vars are **compiled into the browser bundle at `docker build`** (see `docker-compose.yml` build args for the `app` service). Editing `.env` alone is **not enough** — the old URL/key stay baked in the existing image.

**→ Cutover MUST include `docker compose build app` (rebuild), not just a restart.** This is the #1 trap; it's baked into the cutover checklist below.

### Optional refinement
Add `SUPABASE_INTERNAL_URL=http://kong:8000` and have `src/lib/supabase/server.ts` prefer it over `NEXT_PUBLIC_SUPABASE_URL`, so the heavy server-side query traffic skips the Traefik hairpin. Low priority (traffic is free either way); do only if we want the efficiency.

---

## 7. Schema migrations

The 24 files in `supabase/migrations/` create the `public` schema, RLS policies, and PL/pgSQL functions. They reference Supabase roles + `auth` schema, which exist in self-hosted Supabase.

**Application method (to finalize during impl):** either mount them as Postgres init scripts on first boot, or apply via `psql`/Supabase CLI after the `auth` schema is created by GoTrue. Order matters — GoTrue must create `auth.*` before migration `021` (auth migration) runs.

---

## 8. Data migration (31 MB — keeping accounts + history)

We **migrate**, not start fresh. Approach:

1. `pg_dump` the **cloud** DB:
   - `public` schema → games, rooms, votes, history, etc.
   - `auth` schema → `auth.users`, `auth.identities` (the accounts).
2. Restore into the **self-hosted** Postgres (after GoTrue has created the `auth` schema and our migrations have built `public`).

**Password preservation:** GoTrue stores passwords as **bcrypt hashes**, independent of `JWT_SECRET`. Migrating the `auth.users` rows preserves everyone's existing password.

**The one blip:** old session cookies were signed with the cloud's JWT secret, so after cutover **each person logs in once** (same password). With auto-confirm on, this is frictionless.

**Credential handling:** the dump needs read access to the cloud DB. I'll provide the exact `pg_dump` command; **you** paste in the connection string from the Supabase dashboard so the credential never leaves your hands.

**Exact `pg_dump`/restore flags get finalized in Phase 3** (test migration into the local stack), where we can iterate safely — 31 MB makes this fast and forgiving.

---

## 9. Phased implementation plan

> Each phase is a checkpoint. We don't proceed until the current phase is green.

### Phase 0 — Branch & plan ✅
- [x] Create `feat/self-host-supabase`
- [x] Write this plan
- [x] You review & approve the plan

### Phase 1 — Build the local stack (no DNS, no DB access needed) ✅
- [x] Trimmed Supabase stack at `supabase/docker/` (db, auth, rest, realtime, kong). Kong on `localhost:54321`, Postgres on `localhost:54322` (8000/5432 were taken by other docker projects on this box)
- [x] `generate-keys.mjs` → `JWT_SECRET`, HS256 anon/service keys, passwords in `supabase/docker/.env` (gitignored)
- [x] Boot: all 5 containers healthy. Base compose has no analytics/vector at all → boot-breaker is a non-issue
- [x] Applied all **22** migrations (numbering skips 016/017). 13 public tables + RLS + `auth.uid()/role()/jwt()` verified end-to-end through Kong→PostgREST

### Phase 2 — Point the app at the local stack & validate a full game
- [ ] Set local `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000` + new keys; rebuild app
- [ ] Smoke test (empty DB): **signup → login → session refresh**
- [ ] Create room, distribute roles, **play a full game** (proposals, votes, quests)
- [ ] Verify **Realtime broadcast** (draft/vote/action updates + phase transitions) — *the one historically-flaky piece*
- [ ] Verify **bot/agent flow**: Bearer-token auth + 2s polling against the new stack
- [ ] Verify special phases: Lady of the Lake, Assassin, Merlin quiz
- [ ] (If applicable) AI reviewer agent still works

### Phase 3 — Test the data migration locally
- [ ] You run the provided `pg_dump` against cloud → produce dump file
- [ ] Restore into local self-hosted DB
- [ ] Confirm: accounts present, **existing password logs in**, game history intact, RLS still correct

### Phase 4 — Deploy the stack to the VM
- [ ] You add DNS **A-record**: `supabase.playavalon.fun` → VM IP
- [ ] Add Traefik labels/route for `supabase.playavalon.fun` → `kong:8000` (TLS via existing Let's Encrypt resolver)
- [ ] Bring up the stack on the VM (prod profile); confirm TLS + health
- [ ] Apply migrations to the VM's self-hosted DB

### Phase 5 — Cutover (see runbook §10)
- [ ] Maintenance heads-up to the friends (brief)
- [ ] Run real data migration (cloud → VM self-hosted)
- [ ] Swap `.env` to self-hosted URL/keys
- [ ] **Rebuild app image** (build-time baking!)
- [ ] Restart app + bot-supervisor
- [ ] Smoke test on prod

### Phase 6 — Validate & merge
- [ ] Play a **real game on the VM** against self-hosted Supabase
- [ ] Confirm Supabase dashboard egress flatlines (sanity check)
- [ ] Merge `feat/self-host-supabase` → `main`

### Phase 7 — Cleanup
- [ ] Update the `cleanup-cron` comment (auto-pause keepalive no longer relevant; room-cleanup duty remains)
- [ ] Keep the cloud project **read-only/paused** for a grace window, then decommission
- [ ] Note in README: DB is now self-hosted

---

## 10. Cutover & rollback runbook

### Cutover (Phase 5, condensed)
1. `cd` to repo on VM, `git pull` the branch.
2. Bring up self-hosted Supabase stack; verify health + TLS on `supabase.playavalon.fun`.
3. Apply migrations to self-hosted DB.
4. Run data migration (cloud dump → self-hosted restore).
5. Edit `.env`: self-hosted URL + new anon/service keys + JWT secret + pg password.
6. **`docker compose build app`** ← mandatory (baked `NEXT_PUBLIC_*`).
7. `docker compose up -d app bot-supervisor`.
8. Smoke test: login (existing password), play a round, watch broadcast.

### Rollback (safe — cloud data is never destroyed during cutover)
The cloud project is only **read** during migration, so rollback is trivial:
1. Revert `.env` to the cloud URL + cloud keys.
2. **`docker compose build app`** (rebuild — same baking rule).
3. `docker compose up -d app bot-supervisor`.
4. App is back on cloud Supabase, data intact.

Keep the cloud project alive until we've played several real games on self-hosted without issues.

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Self-hosted **Realtime** broadcast flaky | Medium | We use only broadcast (simplest feature); test explicitly in Phase 2; polling is a fallback anyway |
| Forgot to rebuild after env change (baking trap) | Medium | Called out everywhere; in cutover + rollback checklists |
| `analytics` container breaks boot | Medium | Dropped entirely, incl. `depends_on` refs |
| Data migration `auth` schema conflicts | Medium | Iterate locally in Phase 3 before touching prod; 31 MB is fast to retry |
| VM bandwidth allowance | Low | ~10 friends weekly; check VM provider's egress cap once |
| VM disk dies (no backups) | Low/accepted | Out of scope by decision; this doc is the rebuild runbook; take a manual `pg_dump` before risky ops |

---

## 12. What's needed from you (just-in-time, not all up front)

| When | What | Why |
|---|---|---|
| Phase 3 | Run a `pg_dump` (I provide the command; you supply the cloud connection string) | Keeps the DB credential with you |
| Phase 4 | Add DNS A-record `supabase.playavalon.fun` → VM IP | Browser needs a public HTTPS endpoint for Auth + Realtime |
| Phase 5 | A short maintenance heads-up to the friends | Everyone re-logs-in once after cutover |

---

## 13. Decisions log
- **Self-host full Supabase stack** (not vanilla Postgres) — preserves all code + migrations; avoids auth rewrite.
- **Migrate data** (not start fresh) — keep accounts + history; passwords preserved via bcrypt.
- **Drop** storage/imgproxy/functions/analytics/vector/supavisor — unused.
- **No HA / no automated backups** — accepted risk at our scale.
- **Option A (polling reduction) is OUT of scope** — self-hosting makes the polling traffic free (internal Docker network), so there's no need to slow polls or risk a laggier game. The current 3s (browser) / 2s (bots) polling stays exactly as-is.
- **Branch → local test → VM test → cutover → merge** — `main` stays on cloud Supabase and fully working until the very end.
