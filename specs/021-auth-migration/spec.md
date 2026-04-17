# Feature Specification: Auth Migration — Accounts Replace localStorage Identity

**Feature Branch**: `021-auth-migration`
**Created**: 2026-04-17
**Status**: Draft
**Input**: Replace current localStorage UUID-based player identity with Supabase Auth accounts (username + email + password). Clean break — no backward compatibility.

## Overview

The current app identifies players via a client-generated UUID stored in localStorage. That UUID is sent as an `X-Player-ID` header on every request, and all RLS policies trust it via a Postgres session variable `app.player_id`. This works for quick-join gameplay but has critical limitations:

- Same nickname can't sign in from a second device without error
- No stable identity across games (localStorage is per-browser)
- No way to anchor long-lived data (voice recordings, AI memory, history) to a specific human
- Anyone who copies someone else's localStorage UUID impersonates them

This feature replaces that system entirely with Supabase Auth: real accounts with username + email + password, email-based password recovery, and `auth.uid()` as the canonical identity throughout the stack. The primary driver is the planned AI agent player — it requires stable per-human identity to build persistent memory and associate voice data across game sessions.

This is a **clean-break migration**. Existing data (players, rooms, games) will be wiped. Old localStorage identity code is removed entirely. No fallback paths, no migration shims.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — First-Time Signup (Priority: P1)

As a new player, I want to create an account with a username, email, and password so I can identify myself across devices and game sessions.

**Why this priority**: Without signup, no one can use the app.

**Independent Test**: Navigate to the app's signup page, enter a username, email, and password, submit, and land on a logged-in home screen.

**Acceptance Scenarios**:

1. **Given** I am on the signup page, **When** I submit a valid username + email + password, **Then** a Supabase Auth user is created and I am redirected to the home page as a logged-in user
2. **Given** I am on the signup page, **When** I submit a username that is already taken, **Then** I see a clear error message and the form remains filled
3. **Given** I am on the signup page, **When** I submit an email that is already registered, **Then** I see a clear error message
4. **Given** I submit a weak password, **When** it fails Supabase's password policy, **Then** I see the password requirements

---

### User Story 2 — Login (Priority: P1)

As a returning player, I want to log in with either my username or my email plus my password so I can access my account from any browser or device.

**Why this priority**: Core to the "identity across devices" value proposition.

**Independent Test**: From a logged-out state, enter either the username or email and the correct password, submit, and land on the home page logged in.

**Acceptance Scenarios**:

1. **Given** I am on the login page, **When** I enter my username + correct password, **Then** I am logged in
2. **Given** I am on the login page, **When** I enter my email + correct password, **Then** I am logged in
3. **Given** I enter a wrong password, **Then** I see a generic "invalid credentials" error (no enumeration of whether the username/email exists)
4. **Given** I am logged in on one browser, **When** I log in on a second browser, **Then** both sessions work simultaneously (no "already in game" error)

---

### User Story 3 — Password Recovery (Priority: P1)

As a user who forgot my password, I want to reset it via a link sent to my email so I can regain access to my account without contacting an administrator.

**Why this priority**: Without email recovery, forgotten passwords require manual admin intervention — not acceptable long-term.

**Independent Test**: From the login page, click "Forgot password," enter the registered email, receive the email, click the link, set a new password, and log in with the new password.

**Acceptance Scenarios**:

1. **Given** I am on the "Forgot password" page, **When** I submit a registered email, **Then** I receive a password reset email within 1 minute
2. **Given** I click the reset link in the email, **When** the link is valid and unexpired, **Then** I am taken to a "Set new password" page
3. **Given** I set a new password, **When** I submit it, **Then** I can log in with the new password
4. **Given** I submit an unregistered email to "Forgot password," **Then** I see a generic success message (no enumeration)

---

### User Story 4 — Join and Play a Room While Authenticated (Priority: P1)

As a logged-in user, I want to create or join a room and play a game, with my identity automatically tied to my account — not to a localStorage UUID.

**Why this priority**: The entire gameplay flow must work under the new auth system.

**Independent Test**: Log in, create a room, have another logged-in user join from a different browser, start a game, play to completion.

**Acceptance Scenarios**:

1. **Given** I am logged in, **When** I create a room, **Then** my Supabase Auth `user_id` is the room's manager
2. **Given** I am logged in, **When** I join a room, **Then** my Supabase Auth `user_id` is added to `room_players`
3. **Given** I am logged in in two browsers, **When** I try to join the same room from the second browser while already in it, **Then** the second browser seamlessly resumes my seat (no duplicate player row, no "already in room" error)
4. **Given** I am not logged in, **When** I navigate to any gameplay route, **Then** I am redirected to the login page

---

### User Story 5 — Reconnection After Disconnect (Priority: P2)

As a logged-in player whose connection dropped mid-game, I want to reopen the app in any browser and resume my seat without manual intervention.

**Why this priority**: Reconnection already works via localStorage today; auth should make it strictly better, not regress.

**Independent Test**: Join a game, close the browser, reopen from any device, log in, land on the same game in the same seat.

**Acceptance Scenarios**:

1. **Given** I was playing a game and my session ended, **When** I log in again, **Then** the app detects my active room and offers to rejoin
2. **Given** I rejoin, **Then** I resume the exact seat and role I had before
3. **Given** I log in from a second device while my original session is still active, **Then** my seat transfers to the new device (or both sessions share state — whichever is simpler)

---

### Edge Cases

- **Email delivery fails** (Supabase SMTP lands in spam): for small-group scale, acceptable; document workaround (check spam folder) in UI copy
- **Username contains case variations** (`Alice` vs `alice`): username lookups MUST be case-insensitive; storage canonicalized to lowercase or use `ILIKE` / case-insensitive unique index
- **User deletes their Supabase Auth account**: `players` table FK cascades deletion — their game history is lost. Acceptable for MVP.
- **Session expires mid-game**: user is redirected to login; after re-login, they're returned to the game page
- **Signup during concurrent username claim**: DB unique constraint ensures only one succeeds; loser sees a friendly error

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST use Supabase Auth as the sole identity provider. No custom player identity (no localStorage UUIDs, no `X-Player-ID` header).
- **FR-002**: Signup MUST require: username, email, password. All three MUST be unique (username and email separately).
- **FR-003**: Login MUST accept either username or email, plus password.
- **FR-004**: System MUST support email-based password recovery via Supabase Auth's built-in flow.
- **FR-005**: All API routes that require identity MUST read `auth.uid()` from the Supabase session (via cookies), not from a custom header.
- **FR-006**: All RLS policies MUST use `auth.uid()`, not `app.player_id`.
- **FR-007**: All gameplay pages (`/rooms/*`, `/game/*`) MUST redirect unauthenticated users to the login page.
- **FR-008**: Public pages (landing, signup, login, forgot-password, reset-password) MUST remain accessible without auth.
- **FR-009**: The `players` table MUST have a foreign key to `auth.users(id)` as the canonical identity column. The old `player_id` varchar column MUST be dropped.
- **FR-010**: Username uniqueness MUST be case-insensitive.
- **FR-011**: Logout MUST clear the session and redirect to the login page.
- **FR-012**: All old localStorage-based identity code (`src/lib/utils/player-id.ts`, `src/hooks/usePlayer.ts`, `/api/players`, `/api/players/restore-session`, `/api/rooms/[code]/reclaim`, all `X-Player-ID` header handling) MUST be removed — not gated behind a feature flag, not left as fallback.

### Key Entities

- **auth.users** (managed by Supabase): canonical identity — `id` (uuid), `email`, plus auth metadata.
- **players** (app table): profile data only — `id` (= `auth.users.id`), `username` (lowercase-unique), `display_name` (cosmetic), `last_activity_at`. Drops `player_id` column.
- **room_players**, **player_roles**, **rooms**: all `player_id` / `manager_id` FKs now reference `players.id` which equals `auth.users.id`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of authenticated API calls are authorized via `auth.uid()` (zero references to `X-Player-ID` header or `app.player_id` session variable remain in code).
- **SC-002**: A user can sign in from two different browsers simultaneously without any "already joined" error.
- **SC-003**: Password recovery email arrives within 1 minute and the reset link works end-to-end.
- **SC-004**: Full gameplay loop (signup → create room → start game → play → game over) works for 2+ users, end-to-end, under the new auth system.
- **SC-005**: Zero uses of `localStorage` for identity-bearing data remain in the codebase (`grep` check).

## Out of Scope

- Migrating existing production data (none exists worth preserving at this stage)
- Social login (Google, GitHub) — email/password only for MVP
- Two-factor authentication
- Magic-link login
- Email verification enforcement (can be toggled in Supabase dashboard later)
- Admin UI for managing users (handled via Supabase dashboard for now)
- Session revocation UI (logout from all devices)
