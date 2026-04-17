# Tasks: Auth Migration

**Input**: Design documents from `/specs/021-auth-migration/`
**Prerequisites**: spec.md, plan.md

**Tests**: Not requested — manual E2E testing per the QA pass in Phase 4.

**Organization**: Tasks grouped by implementation phase. Within each phase, `[P]` marks tasks that can run in parallel (different files, no dependencies on each other within the phase).

## Format: `[ID] [P?] [Phase] Description`

- **[P]**: Safe to run in parallel with other [P] tasks in the same phase
- **All file paths** are relative to repo root

---

## Phase 1 — Foundation (DB + Supabase clients + Middleware)

**Purpose**: Set up the core identity plumbing before any UI or gameplay code changes.

**Blocking**: All subsequent phases depend on Phase 1 completing.

- [ ] **T001** Create `supabase/migrations/021_auth_migration.sql`:
  - Drop all old app data (`players`, `room_players`, `rooms`, `games`, `player_roles`, `votes`, `proposals`, `quest_actions`, `lady_investigations`, `merlin_quiz_answers`, `game_events`)
  - Drop old RLS policies (from `002_rls_policies.sql`)
  - Drop old helper functions (`reclaim_seat`, `set_config` if custom, any `app.player_id`-referencing funcs)
  - Rewrite `players` table: `id UUID PK REFERENCES auth.users(id) ON DELETE CASCADE`, `username TEXT UNIQUE NOT NULL`, `display_name TEXT NOT NULL`, `last_activity_at`, `created_at`, `updated_at`. Drop `player_id` varchar column.
  - Add lowercase-unique index on `username`
  - Re-add FKs on `room_players.player_id`, `player_roles.player_id`, `rooms.manager_id`, etc. → all reference `players(id)` which equals `auth.users(id)`
  - Write new RLS policies using `auth.uid()` for all tables (see plan.md for policy drafts)

- [ ] **T002** Apply migration to local Supabase and verify:
  - `npm run db:reset` (or equivalent)
  - Verify in Supabase dashboard: new `players` schema, new RLS policies, no orphaned references

- [ ] **T003** Rewrite `src/lib/supabase/server.ts`:
  - Use `createServerClient` from `@supabase/ssr`
  - Export `createClient()` that reads/writes Next.js cookies
  - Export `getUser()` helper: returns `auth.uid()` or null
  - Remove `createServerClientWithPlayer(playerId)`, `getPlayerIdFromRequest()`, `set_config` RPC usage
  - Keep service-role client export for admin operations (room cleanup, etc.)

- [ ] **T004** Rewrite `src/lib/supabase/client.ts`:
  - Use `createBrowserClient` from `@supabase/ssr`
  - Export singleton browser client
  - Remove `createClientWithPlayer(playerId)`, `x-player-id` header logic
  - Remove `persistSession: false` — sessions now persist via cookies

- [ ] **T005** Create `src/middleware.ts`:
  - Use `@supabase/ssr` middleware pattern to refresh session
  - Public routes allowlist: `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/api/auth/*`
  - If no session and request is for a protected route → redirect to `/login?returnTo=...`
  - If session exists and request is for `/login` or `/signup` → redirect to `/`
  - Also apply to API routes: return 401 JSON for protected `/api/*` without session

**Checkpoint**: Run `npm run dev`. DB is fresh, clients use cookies, middleware enforces auth. No UI exists yet for auth — app is unusable but the plumbing is in.

---

## Phase 2 — Auth UI + Auth API Routes

**Purpose**: Enable users to sign up, log in, and recover passwords.

- [ ] **T006** Create `src/app/api/auth/signup/route.ts`:
  - POST handler, input `{ username, email, password, displayName }`
  - Validate: username case-insensitive not taken (query `players.username`), basic input validation
  - Use service-role client to call `supabase.auth.admin.createUser({ email, password, email_confirm: false })` — or regular signUp if email confirmation is off
  - On success, insert `players` row: `id = newUser.id, username: lowercase, display_name: displayName, last_activity_at: now()`
  - Also sign the user in (set cookie via server client `signInWithPassword`)
  - Return success or structured error

- [ ] **T007** Create `src/app/api/auth/login/route.ts`:
  - POST handler, input `{ identifier, password }`
  - If `identifier` matches email regex → use as email; else look up email via `players.username → auth.users.email` (service role)
  - Call `supabase.auth.signInWithPassword({ email, password })` on server client (sets cookie)
  - Return success or generic "invalid credentials" error

- [ ] **T008** Create `src/app/api/auth/logout/route.ts`:
  - POST handler, calls `supabase.auth.signOut()` on server client
  - Returns success

- [ ] **T009** [P] Create `src/app/signup/page.tsx`:
  - Form: username, email, password, displayName
  - Client-side validation (non-empty, password length)
  - On submit: POST to `/api/auth/signup`
  - On success: redirect to `/`
  - On error: show message

- [ ] **T010** [P] Create `src/app/login/page.tsx`:
  - Form: identifier (username or email), password
  - Link to `/forgot-password` and `/signup`
  - On submit: POST to `/api/auth/login`
  - On success: redirect to `returnTo` or `/`

- [ ] **T011** [P] Create `src/app/forgot-password/page.tsx`:
  - Form: email only
  - On submit: call `supabase.auth.resetPasswordForEmail(email, { redirectTo: '/reset-password' })` from browser client
  - Always show generic "If this email is registered, you'll receive a reset link" message

- [ ] **T012** [P] Create `src/app/reset-password/page.tsx`:
  - Reads code from URL hash
  - Form: new password, confirm password
  - On submit: call `supabase.auth.updateUser({ password })` (session is set from auth redirect)
  - On success: redirect to `/`

- [ ] **T013** Create `src/hooks/useAuth.tsx`:
  - Client hook that reads current user + profile
  - Exposes `{ user, profile, loading, signOut }`
  - Subscribes to `onAuthStateChange`
  - Replaces `usePlayer`

- [ ] **T014** Update `src/app/page.tsx` (home page):
  - Show login/signup buttons if not authenticated
  - Show welcome message with `profile.display_name` and logout button if authenticated
  - Remove all references to localStorage player bootstrap

**Checkpoint**: A new user can sign up, log in, log out, and reset their password. Home page reflects auth state. Gameplay routes still broken (Phase 3 fixes them).

---

## Phase 3 — Gameplay Rewiring (Remove legacy, use auth.uid())

**Purpose**: Replace every use of localStorage/`X-Player-ID` with `auth.uid()` in the gameplay stack. This is the bulk of the work.

### Subphase 3A — Delete legacy files

- [ ] **T015** Delete `src/lib/utils/player-id.ts`
- [ ] **T016** Delete `src/hooks/usePlayer.ts`
- [ ] **T017** Update `src/hooks/useHeartbeat.ts` — keep for presence indicators and seat reclaim. Remove `getPlayerId`/`X-Player-ID` usage; rely on cookies. Gate execution on `useAuth().user` being present.
- [ ] **T018** Delete `src/app/api/players/route.ts`
- [ ] **T019** Delete `src/app/api/players/restore-session/route.ts`
- [ ] **T020** Delete `src/app/api/players/heartbeat/route.ts`
- [ ] **T021** Delete `src/app/api/rooms/[code]/reclaim/route.ts`
- [ ] **T022** Delete `src/components/ReturningPlayerPanel.tsx` (no longer needed — auth session handles resume)

### Subphase 3B — Update Supabase service modules

- [ ] **T023** [P] Update `src/lib/supabase/players.ts`:
  - Remove `player_id` parameter from all functions; use `userId` (= `auth.uid()`)
  - `findPlayerByPlayerId` → `findPlayerByUserId`
  - `updateActivity(userId)` → updates `last_activity_at` for `id = userId`

- [ ] **T024** [P] Update `src/lib/supabase/rooms.ts`:
  - All player references use `userId` (= `players.id`)

- [ ] **T025** [P] Update `src/lib/supabase/games.ts`:
  - Same

- [ ] **T026** [P] Update `src/lib/supabase/votes.ts`, `proposals.ts`, `quest-actions.ts`, `roles.ts`, `lady-investigations.ts`, `merlin-quiz.ts`, `game-events.ts`:
  - All use `userId` (= `auth.uid()`)

### Subphase 3C — Update API routes

- [ ] **T027** [P] Update `src/app/api/rooms/[code]/join/route.ts`:
  - Remove `X-Player-ID` header read; call `getUser()` instead
  - If no session → 401
  - Pass `userId` to room-joining logic

- [ ] **T028** [P] Update `src/app/api/rooms/[code]/route.ts` (GET): use `getUser()`
- [ ] **T029** [P] Update `src/app/api/rooms/[code]/start/route.ts`: use `getUser()`
- [ ] **T030** [P] Update `src/app/api/rooms/[code]/confirm/route.ts`: use `getUser()`
- [ ] **T031** [P] Update `src/app/api/rooms/[code]/distribute/route.ts`: use `getUser()`
- [ ] **T032** [P] Update `src/app/api/rooms/[code]/leave/route.ts`: use `getUser()`
- [ ] **T033** [P] Update `src/app/api/rooms/[code]/role/route.ts`: use `getUser()`
- [ ] **T034** [P] Update `src/app/api/rooms/[code]/game/route.ts`: use `getUser()`
- [ ] **T035** [P] Update `src/app/api/games/[gameId]/**/route.ts` (all game action routes): use `getUser()`
- [ ] **T036** [P] Update `src/app/api/livekit/token/route.ts`: use `getUser()`; read displayName from `players` for LiveKit participant metadata
- [ ] **T037** [P] Update `src/app/api/rooms/route.ts` (POST create room): use `getUser()`; set `manager_id = userId`

### Subphase 3D — Update client code

- [ ] **T038** Update `src/lib/api/game.ts`:
  - Remove all `'X-Player-ID'` headers from fetch calls
  - Cookies travel automatically with same-origin fetches

- [ ] **T039** Update `src/app/rooms/[code]/page.tsx`:
  - Remove localStorage bootstrap
  - Use `useAuth()` to get current user
  - Redirect to `/login?returnTo=/rooms/[code]` if not authenticated (middleware should also enforce this)

- [ ] **T040** Update `src/app/game/[gameId]/page.tsx`: same pattern as T039

- [ ] **T041** Update `src/components/Lobby.tsx`:
  - Use `useAuth` instead of `usePlayer`
  - `userId` replaces `playerId` throughout

- [ ] **T042** Update `src/components/FindMyGame.tsx`:
  - Delete if no longer needed, or update to use auth session

- [ ] **T043** Grep sweep — ensure zero references remain to:
  - `localStorage.getItem('avalon_player_id')`
  - `'X-Player-ID'` / `'x-player-id'`
  - `current_setting('app.player_id'` in any SQL
  - `usePlayer` imports
  - `getPlayerId` from `@/lib/utils/player-id`

**Checkpoint**: End-to-end auth-based gameplay works in dev. Two logged-in browsers can create + join a room.

---

## Phase 4 — Configuration & QA

- [ ] **T044** Configure Supabase dashboard (production + dev projects):
  - Auth → URL Configuration → site URL: `https://playavalon.fun` (prod), `http://localhost:3000` (dev)
  - Auth → URL Configuration → redirect URLs: add `/reset-password`
  - Auth → Email Templates → customize "Reset Password" template with branded copy
  - Auth → Sign In / Providers → Email: confirm "Confirm email" setting (off for dev, on for prod)
  - Auth → Rate Limits: review defaults (fine for 10-12 users)

- [ ] **T045** Manual E2E QA pass (fresh DB):
  - Signup with new username/email/password
  - Logout
  - Login with username
  - Logout, log back in with email
  - Forgot password → receive email → reset → log in with new password
  - Create room as user A
  - Log in as user B in a different browser → join room
  - Open user A's account in a second browser simultaneously → verify seat transfers or syncs (no error)
  - Start game → play to completion
  - Verify direct URL access to a protected route while logged out redirects to `/login`
  - Verify accessing `/login` while logged in redirects to `/`

- [ ] **T046** Grep + cleanup pass:
  - Remove any dead imports left over from deleted files
  - Verify no `X-Player-ID`, `player_id` (varchar sense), `app.player_id`, `localStorage.*player` strings remain in code

- [ ] **T047** Update `ROADMAP.md` or similar docs if they still reference the old identity flow.

---

## Dependencies

- Phase 1 blocks all other phases
- Phase 2 can start in parallel with 3A (delete legacy) once Phase 1 is done
- Phase 3B–3D depend on Phase 1 (client/middleware) and Phase 2 (auth routes exist so login works during testing)
- Phase 4 runs after Phase 3 completes

## Rollback Plan

- This migration is one-way by design (clean break)
- If catastrophic issues appear in staging/prod: restore previous DB backup and `git revert` the relevant merge commit
- No partial rollback possible — auth and gameplay are tightly coupled after this migration
