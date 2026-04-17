# Implementation Plan: Auth Migration

**Branch**: `021-auth-migration` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-auth-migration/spec.md`

## Summary

Replace the current localStorage UUID + `X-Player-ID` header identity system with Supabase Auth (username + email + password) using cookie-based sessions via `@supabase/ssr`. Clean break — no backward compatibility.

## Technical Context

**Language/Version**: TypeScript 5.7.2, Next.js 15.x (App Router), React 18
**New Dependencies**: `@supabase/ssr` (already installed 2026-04-17)
**Existing Dependencies**: `@supabase/supabase-js` (already used)
**Storage**: Supabase Postgres (hosted). `auth.users` managed by Supabase Auth. App tables remain in `public` schema.
**Testing**: Manual E2E testing per quickstart.md; no automated test requirement

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| Spec-Driven Development | ✅ PASS | Spec created before plan |
| Domain Logic Isolation | ✅ PASS | Auth helpers isolated in `src/lib/supabase/*` |
| Server-Side Authority | ✅ PASS | All identity validation happens server-side via `auth.uid()` and RLS |
| Data Persistence | ✅ PASS | Identity persisted in Supabase Auth; profile in `players` table |
| No Breaking Changes | ⚠️ BREAKING | Intentional clean break — existing data wiped, no fallback |

The "breaking change" is the explicit intent of this spec, as confirmed by the user.

## Architecture Overview

### Current State

```
Browser localStorage → UUID → sent as X-Player-ID header → server reads header
  → sets `app.player_id` Postgres session var → RLS policies check it
```

### Target State

```
Supabase Auth (email+pw) → JWT in httpOnly cookie → @supabase/ssr reads cookie
  → server-side Supabase client with session → RLS policies check auth.uid()
```

### Files to Create

| File | Purpose |
|------|---------|
| `supabase/migrations/021_auth_migration.sql` | Drop old player identity, add FK to auth.users, rewrite RLS policies |
| `src/lib/supabase/server.ts` (rewrite) | Cookie-based server client via `@supabase/ssr` |
| `src/lib/supabase/client.ts` (rewrite) | Cookie-based browser client via `@supabase/ssr` |
| `src/middleware.ts` | Next.js middleware for session refresh + route protection |
| `src/app/signup/page.tsx` | Signup form (username + email + password) |
| `src/app/login/page.tsx` | Login form (username-or-email + password) |
| `src/app/forgot-password/page.tsx` | Request password reset email |
| `src/app/reset-password/page.tsx` | Set new password from email link |
| `src/app/api/auth/signup/route.ts` | Signup handler (validates username uniqueness, creates auth user + players row) |
| `src/app/api/auth/login/route.ts` | Login handler (resolves username → email if needed) |
| `src/app/api/auth/logout/route.ts` | Logout handler |
| `src/hooks/useAuth.tsx` | Client-side auth state hook (replaces `usePlayer`) |

### Files to Delete

| File | Reason |
|------|--------|
| `src/lib/utils/player-id.ts` | localStorage UUID generation — gone |
| `src/hooks/usePlayer.ts` | Replaced by `useAuth` |
| `src/app/api/players/route.ts` | Player registration replaced by signup |
| `src/app/api/players/restore-session/route.ts` | No longer needed — auth session restores automatically |
| `src/app/api/rooms/[code]/reclaim/route.ts` | No longer needed — no identity transfer |

### Files to Modify

| File | Change |
|------|--------|
| `src/app/api/rooms/[code]/join/route.ts` | Read `auth.uid()` instead of `X-Player-ID` header |
| `src/app/api/rooms/[code]/route.ts` | Ditto |
| `src/app/api/rooms/[code]/start/route.ts` | Ditto |
| `src/app/api/rooms/[code]/confirm/route.ts` | Ditto |
| `src/app/api/rooms/[code]/distribute/route.ts` | Ditto |
| `src/app/api/rooms/[code]/leave/route.ts` | Ditto |
| `src/app/api/rooms/[code]/role/route.ts` | Ditto |
| `src/app/api/rooms/[code]/game/route.ts` | Ditto |
| `src/app/api/games/**/*.ts` | Ditto for all game action routes |
| `src/app/api/livekit/token/route.ts` | Ditto |
| `src/lib/api/game.ts` | Remove `X-Player-ID` from all fetch calls (cookies handle auth automatically) |
| `src/lib/supabase/players.ts` | Remove `player_id` column references; use `id` (= auth.uid()) |
| `src/lib/supabase/rooms.ts` | Same |
| `src/lib/supabase/games.ts` | Same |
| `src/lib/supabase/{votes,proposals,quest-actions,roles,lady-investigations,merlin-quiz,game-events}.ts` | Same |
| `src/app/page.tsx` | Add "Login / Signup" buttons; check auth state; show user's display name |
| `src/app/rooms/[code]/page.tsx` | Remove localStorage player bootstrap; use auth session |
| `src/app/game/[gameId]/page.tsx` | Same |
| `src/components/Lobby.tsx` | Same |
| `src/components/FindMyGame.tsx` | Same |
| `src/components/ReturningPlayerPanel.tsx` | Likely delete entirely (session restores automatically) |

## Database Migration Plan

### New Schema

```sql
-- players table: id now equals auth.users.id
CREATE TABLE players (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,           -- stored lowercase for case-insensitive uniqueness
  display_name TEXT NOT NULL,              -- cosmetic, shown in UI
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_players_username ON players(username);
```

### RLS Policies (rewrite)

```sql
-- players: users read/update only their own row
CREATE POLICY "players_select_own" ON players
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "players_update_own" ON players
  FOR UPDATE USING (id = auth.uid());

-- rooms: readable if user is in the room or is the manager
CREATE POLICY "rooms_select_member" ON rooms
  FOR SELECT USING (
    manager_id = auth.uid() OR
    EXISTS (SELECT 1 FROM room_players WHERE room_id = rooms.id AND player_id = auth.uid())
  );

-- room_players: readable if user is in the same room
CREATE POLICY "room_players_select_member" ON room_players
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM room_players rp WHERE rp.room_id = room_players.room_id AND rp.player_id = auth.uid())
  );

-- player_roles: users read only their own role
CREATE POLICY "player_roles_select_own" ON player_roles
  FOR SELECT USING (player_id = auth.uid());
```

### Migration Strategy

- **No data preservation**. Drop all rows from `players`, `room_players`, `rooms`, `games`, `player_roles`, `votes`, etc. before applying schema changes.
- Drop old helper functions that reference `app.player_id` (e.g., `reclaim_seat`).
- Drop old migrations `002_rls_policies.sql` policies and replace.
- The old `player_id VARCHAR(36)` column is dropped.
- Existing `players.id` (UUID PK) repurposed: now FK to `auth.users(id)`.

## Auth Flow Details

### Signup

1. User submits `{ username, email, password }` to `POST /api/auth/signup`
2. Server validates: username not taken (case-insensitive), password meets Supabase policy
3. Server calls `supabase.auth.signUp({ email, password })` with admin/service-role client
4. On success, server inserts `players` row with `id = auth.user.id`, `username`, `display_name`
5. Server returns success; client redirects to home

### Login

1. User submits `{ identifier, password }` to `POST /api/auth/login` (identifier = username or email)
2. Server detects: if identifier looks like an email, use as-is; otherwise look up email from `players.username`
3. Server calls `supabase.auth.signInWithPassword({ email, password })` (via server client — sets cookie)
4. Returns success; client redirects to home or `returnTo` URL

### Password Recovery

1. User submits email on `/forgot-password` → calls `supabase.auth.resetPasswordForEmail(email)`
2. Supabase sends email with link to `/reset-password?code=...`
3. On `/reset-password`, call `supabase.auth.exchangeCodeForSession(code)` then `supabase.auth.updateUser({ password })`

### Middleware

Runs on every request. Uses `@supabase/ssr` pattern:
- Reads session cookie
- If session is close to expiring, refreshes it
- For protected routes (`/rooms/*`, `/game/*`, `/api/rooms/*`, `/api/games/*`): if no session, redirect or return 401
- For auth pages (`/login`, `/signup`) while logged in: redirect to home

## Client State

Replace `usePlayer` with `useAuth`:

```typescript
// Before
const { playerId, nickname, isRegistered, register } = usePlayer();

// After
const { user, profile, loading, signOut } = useAuth();
// user: Supabase auth user (has id, email)
// profile: row from players table (username, display_name)
```

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Cookie-based sessions break LiveKit token endpoint | `/api/livekit/token` becomes auth-protected; reads `auth.uid()`; same validation logic, different identity source |
| RLS policies accidentally lock out users | Test each policy in Supabase SQL editor before deploying; keep service-role fallback path for admin operations |
| Old data blocks migration (FK violations) | Drop all app data in migration before schema changes |
| Middleware infinite loops (auth redirect → login page → middleware → ...) | Explicit allowlist of public routes (`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/`, `/api/auth/*`) |
| Email deliverability on free Supabase SMTP | Acceptable for closed 10-12 person group; document "check spam" in UI |

## Phases

- **Phase 1** (foundation): DB migration, supabase client rewrite, middleware
- **Phase 2** (auth UI): signup/login/forgot-password/reset-password pages + API routes
- **Phase 3** (gameplay rewiring): update all API routes + supabase modules to use `auth.uid()`; delete legacy files
- **Phase 4** (polish): reconnection flow, QA, Supabase dashboard config

Detailed tasks: see [tasks.md](./tasks.md).
