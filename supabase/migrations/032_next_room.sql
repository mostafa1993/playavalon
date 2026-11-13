-- ============================================
-- Migration: 032_next_room.sql
-- Date: 2026-11-13
-- Feature: play again — a finished game opens the next room for its players
--
-- When a game is over, any of its players can open one new room with the same
-- settings (POST /api/games/[gameId]/play-again). The finished game points at
-- it, so every player's game-over screen finds the same room:
--   1. games.next_room_id: the room opened for the next game. ON DELETE SET
--      NULL, so a deleted room never leaves a dangling link.
--   2. games.next_room_claimed_by / next_room_claimed_at: who is creating it.
--      The app claims with a conditional update that succeeds only while
--      next_room_id is NULL and there is no claim younger than 30 seconds, so
--      two presses at once make one room; the other press is told the room is
--      being created. The claim is released if creation fails.
--   3. When the next room closes before its game starts (status waiting or
--      roles_distributed -> closed: everyone left, or the clean-up closed it),
--      a trigger clears the link and the claim, so "Play again" is offered
--      again. A next room closed because its own game ended keeps the link:
--      the first game must not offer "Play again" after the second ends.
-- ============================================

BEGIN;

ALTER TABLE games
  ADD COLUMN next_room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  ADD COLUMN next_room_claimed_by uuid REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN next_room_claimed_at timestamptz;

CREATE INDEX idx_games_next_room_id ON games(next_room_id) WHERE next_room_id IS NOT NULL;

COMMENT ON COLUMN games.next_room_id IS 'The room opened for the next game by one of this game''s players (play again). Cleared when that room closes before its game starts.';
COMMENT ON COLUMN games.next_room_claimed_by IS 'The player creating the next room. A claim younger than 30 seconds keeps others from creating a second room.';
COMMENT ON COLUMN games.next_room_claimed_at IS 'When the next room was claimed. See next_room_claimed_by.';

-- SECURITY DEFINER so it works whoever closes the room (games has no client
-- UPDATE policy).
CREATE OR REPLACE FUNCTION release_next_room_link()
RETURNS trigger AS $$
BEGIN
  UPDATE games
  SET next_room_id = NULL,
      next_room_claimed_by = NULL,
      next_room_claimed_at = NULL
  WHERE next_room_id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER rooms_release_next_room_link
  AFTER UPDATE OF status ON rooms
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status IN ('waiting', 'roles_distributed'))
  EXECUTE FUNCTION release_next_room_link();

COMMIT;
