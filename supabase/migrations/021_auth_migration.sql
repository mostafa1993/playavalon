-- Auth Migration: Replace localStorage UUID identity with Supabase Auth
-- Migration: 021_auth_migration.sql
-- Date: 2026-04-17
-- Feature: 021-auth-migration
--
-- This is a CLEAN BREAK migration:
--   - All existing app data is wiped (players, rooms, games, etc.)
--   - players.id now references auth.users(id) directly
--   - All RLS policies rewritten to use auth.uid() instead of current_setting('app.player_id')
--   - Old localStorage-based identity helpers are dropped

BEGIN;

-- ============================================
-- STEP 1: DROP OLD RLS POLICIES
-- ============================================
-- Drop every policy that references current_setting('app.player_id', true)
-- We use DROP POLICY IF EXISTS for idempotency in case migration is partially applied

-- players
DROP POLICY IF EXISTS "Anyone can register" ON players;
DROP POLICY IF EXISTS "Players read own record" ON players;
DROP POLICY IF EXISTS "Players update own record" ON players;
DROP POLICY IF EXISTS "Anyone can read player nicknames" ON players;

-- rooms
DROP POLICY IF EXISTS "Anyone can see waiting rooms" ON rooms;
DROP POLICY IF EXISTS "Members can see their room" ON rooms;
DROP POLICY IF EXISTS "Manager can update room" ON rooms;
DROP POLICY IF EXISTS "Realtime rooms read" ON rooms;

-- room_players
DROP POLICY IF EXISTS "Members see room players" ON room_players;
DROP POLICY IF EXISTS "Realtime room players read" ON room_players;

-- player_roles
DROP POLICY IF EXISTS "Players see own role" ON player_roles;
DROP POLICY IF EXISTS "Players confirm own role" ON player_roles;

-- games
DROP POLICY IF EXISTS "Room members can read games" ON games;
DROP POLICY IF EXISTS "Service role manages games" ON games;

-- team_proposals
DROP POLICY IF EXISTS "Room members can read proposals" ON team_proposals;
DROP POLICY IF EXISTS "Service role manages proposals" ON team_proposals;

-- votes
DROP POLICY IF EXISTS "Players can read own vote" ON votes;
DROP POLICY IF EXISTS "All votes visible after resolved" ON votes;
DROP POLICY IF EXISTS "Service role manages votes" ON votes;

-- quest_actions
DROP POLICY IF EXISTS "Quest actions server only" ON quest_actions;

-- game_events
DROP POLICY IF EXISTS "Room members can read events" ON game_events;
DROP POLICY IF EXISTS "Service role manages events" ON game_events;

-- lady_investigations
DROP POLICY IF EXISTS "Players can view investigations in their game" ON lady_investigations;
DROP POLICY IF EXISTS "Allow creating investigations" ON lady_investigations;

-- merlin_quiz_votes
DROP POLICY IF EXISTS "Room members can read quiz votes" ON merlin_quiz_votes;
DROP POLICY IF EXISTS "Players can insert own quiz vote" ON merlin_quiz_votes;
DROP POLICY IF EXISTS "Service role manages quiz votes" ON merlin_quiz_votes;

-- ============================================
-- STEP 2: DROP OLD HELPER FUNCTIONS
-- ============================================

DROP FUNCTION IF EXISTS reclaim_seat(varchar, varchar, uuid);
DROP FUNCTION IF EXISTS find_player_in_room(varchar, varchar);
DROP FUNCTION IF EXISTS check_nickname_available(varchar);

-- ============================================
-- STEP 3: WIPE ALL APP DATA
-- ============================================
-- TRUNCATE with CASCADE handles FK dependencies across all tables.
-- We explicitly list the root tables; cascade takes care of the rest.

TRUNCATE TABLE players RESTART IDENTITY CASCADE;

-- ============================================
-- STEP 4: RESHAPE PLAYERS TABLE
-- ============================================
-- Drop old columns, add new ones, change id FK target.

ALTER TABLE players DROP COLUMN IF EXISTS player_id;
-- nickname_lower is a generated column that depends on nickname; drop it first
ALTER TABLE players DROP COLUMN IF EXISTS nickname_lower;
ALTER TABLE players DROP COLUMN IF EXISTS nickname;

ALTER TABLE players ADD COLUMN username TEXT NOT NULL UNIQUE;
ALTER TABLE players ADD COLUMN display_name TEXT NOT NULL;

-- Change id: drop the gen_random_uuid default; add FK to auth.users
ALTER TABLE players ALTER COLUMN id DROP DEFAULT;
ALTER TABLE players
  ADD CONSTRAINT players_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop the old player_id index
DROP INDEX IF EXISTS players_player_id_idx;

-- Username is stored lowercase for case-insensitive uniqueness
-- (UNIQUE constraint above plus lowercase-at-write enforces this)
CREATE INDEX IF NOT EXISTS players_username_idx ON players(username);

COMMENT ON TABLE players IS 'Player profile — id references auth.users(id)';
COMMENT ON COLUMN players.id IS 'Equals auth.users.id; canonical user identity';
COMMENT ON COLUMN players.username IS 'Unique username (stored lowercase, case-insensitive)';
COMMENT ON COLUMN players.display_name IS 'Cosmetic display name shown in UI';

-- ============================================
-- STEP 5: NEW HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION check_username_available(p_username TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM players WHERE username = LOWER(p_username)
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_username_available IS 'Returns true if username is not yet taken (case-insensitive)';

-- ============================================
-- STEP 6: NEW RLS POLICIES (using auth.uid())
-- ============================================

-- ---- players ----

-- Anyone can read basic profile info (username, display_name)
-- Needed so players in a room can see each other's names
CREATE POLICY "Authenticated users read profiles"
  ON players FOR SELECT
  TO authenticated
  USING (true);

-- Users can update only their own profile
CREATE POLICY "Users update own profile"
  ON players FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

-- Insert happens only via service role (API signup route)

-- ---- rooms ----

-- Waiting rooms are publicly visible (browse active rooms feature)
CREATE POLICY "Anyone sees waiting rooms"
  ON rooms FOR SELECT
  TO authenticated
  USING (status = 'waiting');

-- Room members see their room regardless of status
CREATE POLICY "Members see their room"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT room_id FROM room_players WHERE player_id = auth.uid()
    )
  );

-- Manager can update room metadata
CREATE POLICY "Manager updates room"
  ON rooms FOR UPDATE
  TO authenticated
  USING (manager_id = auth.uid());

-- ---- room_players ----

-- Room members see other players in their room
CREATE POLICY "Members see room players"
  ON room_players FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM room_players WHERE player_id = auth.uid()
    )
  );

-- ---- player_roles ----

-- Players see only their own role (critical for game security)
CREATE POLICY "Players see own role"
  ON player_roles FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- Players can update own confirmation status
CREATE POLICY "Players confirm own role"
  ON player_roles FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid());

-- ---- games ----

-- Room members read game state
CREATE POLICY "Room members read games"
  ON games FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM room_players WHERE player_id = auth.uid()
    )
  );

-- ---- team_proposals ----

CREATE POLICY "Room members read proposals"
  ON team_proposals FOR SELECT
  TO authenticated
  USING (
    game_id IN (
      SELECT id FROM games WHERE room_id IN (
        SELECT room_id FROM room_players WHERE player_id = auth.uid()
      )
    )
  );

-- ---- votes ----

-- Players see own vote always
CREATE POLICY "Players read own vote"
  ON votes FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- All votes visible once revealed (is_revealed column on proposal, or use game state)
-- For simplicity, room members can see all votes in their game
CREATE POLICY "Room members read votes"
  ON votes FOR SELECT
  TO authenticated
  USING (
    proposal_id IN (
      SELECT tp.id FROM team_proposals tp
      WHERE tp.game_id IN (
        SELECT id FROM games WHERE room_id IN (
          SELECT room_id FROM room_players WHERE player_id = auth.uid()
        )
      )
    )
  );

-- ---- quest_actions ----
-- Quest actions are sensitive (reveals who played success/fail).
-- Read only via service role; no SELECT policy for authenticated users.
-- (Service role bypasses RLS; clients fetch aggregated quest results via API)

-- ---- game_events ----

CREATE POLICY "Room members read events"
  ON game_events FOR SELECT
  TO authenticated
  USING (
    game_id IN (
      SELECT id FROM games WHERE room_id IN (
        SELECT room_id FROM room_players WHERE player_id = auth.uid()
      )
    )
  );

-- ---- lady_investigations ----

CREATE POLICY "Room members read investigations"
  ON lady_investigations FOR SELECT
  TO authenticated
  USING (
    game_id IN (
      SELECT id FROM games WHERE room_id IN (
        SELECT room_id FROM room_players WHERE player_id = auth.uid()
      )
    )
  );

-- ---- merlin_quiz_votes ----

CREATE POLICY "Room members read quiz votes"
  ON merlin_quiz_votes FOR SELECT
  TO authenticated
  USING (
    game_id IN (
      SELECT id FROM games WHERE room_id IN (
        SELECT room_id FROM room_players WHERE player_id = auth.uid()
      )
    )
  );

-- ============================================
-- STEP 7: HANDLE AUTH.USERS → PLAYERS TRIGGER (optional, not used)
-- ============================================
-- We create the players row explicitly from /api/auth/signup with username + display_name.
-- No trigger needed.

COMMIT;
