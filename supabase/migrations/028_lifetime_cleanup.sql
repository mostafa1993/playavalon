-- ============================================
-- Migration: 028_lifetime_cleanup.sql
-- Date: 2026-10-01
-- Feature: game/room lifecycle guarantees (zombie prevention)
--
-- Games could stay "live" (ended_at = NULL) forever: the only way to end one was
-- a natural finish, "finished" was written by hand in several routes (the
-- assassin route forgot ended_at), and 015's archive closed rooms without ending
-- their games. The database now enforces it instead:
--   1. A game set to phase 'game_over' always gets ended_at (trigger).
--   2. Closing a room, by anything, ends its live game with
--      win_reason = 'abandoned' (trigger).
--   3. cleanup_rooms(), every 15 minutes, closes rooms nobody has been in for
--      1 hour (no human heartbeat, room action or game move) and any room 16
--      hours after it was created. Replaces 015's archive_stale_rooms().
--   4. cleanup_rooms() also repairs anything that slipped past 1 and 2:
--      finished games missing ended_at get it, and live games in a closed room
--      or older than 16 hours are ended as abandoned.
-- Abandoned games are kept out of game_statistics.
-- ============================================

BEGIN;

-- --------------------------------------------
-- 1. Finished games always have ended_at.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION set_game_ended_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.phase = 'game_over' AND NEW.ended_at IS NULL THEN
    NEW.ended_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER games_set_ended_at
  BEFORE INSERT OR UPDATE ON games
  FOR EACH ROW
  EXECUTE FUNCTION set_game_ended_at();

-- --------------------------------------------
-- 2. Closing a room ends its live game.
-- SECURITY DEFINER so it works whoever closes the room (games has no client
-- UPDATE policy).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION end_games_in_closed_room()
RETURNS trigger AS $$
BEGIN
  UPDATE games
  SET ended_at = NOW(), win_reason = 'abandoned'
  WHERE room_id = NEW.id
    AND ended_at IS NULL
    AND phase <> 'game_over';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER rooms_end_games_on_close
  AFTER UPDATE OF status ON rooms
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status <> 'closed')
  EXECUTE FUNCTION end_games_in_closed_room();

-- --------------------------------------------
-- 3 + 4. Periodic cleanup + repair.
-- --------------------------------------------
SELECT cron.unschedule('archive-stale-rooms');
DROP FUNCTION manual_room_archive();
DROP FUNCTION run_room_archive();
DROP FUNCTION archive_stale_rooms();

CREATE OR REPLACE FUNCTION cleanup_rooms(
  empty_after interval DEFAULT '1 hour',
  max_lifetime interval DEFAULT '16 hours'
)
RETURNS TABLE (rooms_closed integer, games_repaired integer) AS $$
DECLARE n integer;
BEGIN
  -- Close rooms nobody has been in for empty_after, and rooms older than
  -- max_lifetime. rooms_end_games_on_close ends their live games.
  UPDATE rooms r
  SET status = 'closed', last_activity_at = NOW()
  WHERE r.status <> 'closed'
    AND (
      r.created_at < NOW() - max_lifetime
      OR GREATEST(
           r.last_activity_at,
           (SELECT MAX(p.last_activity_at)
              FROM room_players rp
              JOIN players p ON p.id = rp.player_id
             WHERE rp.room_id = r.id AND NOT rp.is_bot),
           (SELECT MAX(g.updated_at) FROM games g WHERE g.room_id = r.id)
         ) < NOW() - empty_after
    );
  GET DIAGNOSTICS rooms_closed = ROW_COUNT;

  -- Repairs; normally find nothing. Finished games missing ended_at get the
  -- time of their game_ended event...
  UPDATE games g
  SET ended_at = COALESCE(
    (SELECT MIN(e.created_at) FROM game_events e
      WHERE e.game_id = g.id AND e.event_type = 'game_ended'),
    g.updated_at
  )
  WHERE g.phase = 'game_over'
    AND g.ended_at IS NULL;
  GET DIAGNOSTICS games_repaired = ROW_COUNT;

  -- ...and live games in a closed room or older than max_lifetime are ended.
  UPDATE games g
  SET ended_at = NOW(), win_reason = 'abandoned'
  WHERE g.ended_at IS NULL
    AND g.phase <> 'game_over'
    AND (g.created_at < NOW() - max_lifetime
         OR EXISTS (SELECT 1 FROM rooms r WHERE r.id = g.room_id AND r.status = 'closed'));
  GET DIAGNOSTICS n = ROW_COUNT;
  games_repaired := games_repaired + n;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION cleanup_rooms IS
  'Closes rooms empty for 1h or older than 16h, and repairs games left live or missing ended_at. Run on demand: SELECT * FROM cleanup_rooms();';

SELECT cron.schedule('cleanup-rooms', '*/15 * * * *', 'SELECT cleanup_rooms();');

-- --------------------------------------------
-- Keep abandoned games out of statistics.
-- --------------------------------------------
CREATE OR REPLACE VIEW game_statistics AS
SELECT
  g.id as game_id,
  r.code as room_code,
  r.expected_players,
  g.player_count,
  g.winner,
  g.win_reason,
  g.quest_results,
  g.created_at as game_started_at,
  g.ended_at as game_ended_at,
  EXTRACT(EPOCH FROM (g.ended_at - g.created_at)) / 60 as duration_minutes,
  r.status as room_status
FROM games g
JOIN rooms r ON g.room_id = r.id
WHERE g.ended_at IS NOT NULL
  AND g.win_reason IS DISTINCT FROM 'abandoned';

-- Fix what's already broken (finished games missing ended_at, live games in
-- closed rooms).
SELECT * FROM cleanup_rooms();

COMMIT;
