-- ============================================
-- Migration: 028_lifetime_cleanup.sql
-- Date: 2026-08-03
-- Feature: max-lifetime cleanup for games & rooms (zombie prevention)
--
-- A game that never reaches a natural end (crash, disconnect, abandonment) keeps
-- ended_at = NULL forever. Such "zombie" games (a) permanently block the AI
-- reviewer's single-game watcher — an unordered LIMIT 1 keeps re-selecting the
-- oldest one — and (b) skew statistics. This adds lifetime caps enforced by
-- pg_cron, complementing the existing activity-based archive_stale_rooms():
--   - games: force-ended (ended_at = now()) once OLDER THAN 1 day. No Avalon
--            game legitimately runs a full day, so age alone is a safe signal.
--   - rooms: archived (status = 'closed') once INACTIVE for a few hours, and any
--            still-live game they hold is force-ended too.
--
-- IMPORTANT — rooms are keyed on last_activity_at, NOT created_at. created_at is
-- immutable and includes lobby/role-distribution time, so an absolute cap on it
-- would kill a legitimately in-progress game whose room was opened hours before
-- play began. last_activity_at advances on lobby/room actions (join, confirm,
-- start), so a filling lobby or a just-started game keeps a fresh timestamp and
-- is spared; only genuinely-abandoned rooms go stale. (Gameplay itself does not
-- refresh last_activity_at, but no Avalon game runs anywhere near the few-hour
-- cap, so live games are safe.) This mirrors archive_stale_rooms().
--
-- Games are marked done via ended_at only (the canonical "over" flag checked by
-- the reviewer, hasGameEnded, and the game_statistics view). phase/winner are
-- left untouched to avoid any state-machine/constraint coupling.
--
-- All functions pin search_path (SECURITY DEFINER hardening).
-- ============================================

BEGIN;

-- --------------------------------------------
-- Force-end zombie games older than max_age (absolute age — safe because no
-- game runs a day).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION end_zombie_games(max_age interval DEFAULT '1 day')
RETURNS integer AS $$
DECLARE ended_count integer := 0;
BEGIN
  WITH z AS (
    UPDATE games
    SET ended_at = NOW()
    WHERE ended_at IS NULL
      AND created_at < NOW() - max_age
    RETURNING id
  )
  SELECT COUNT(*) INTO ended_count FROM z;
  RETURN ended_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION end_zombie_games IS
  'Force-ends games (ended_at = now()) that never ended and are older than max_age (default 1 day).';

-- --------------------------------------------
-- Archive rooms INACTIVE beyond max_age + end their live games.
-- Keyed on last_activity_at so active rooms/games are spared (see header).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION archive_expired_rooms(max_age interval DEFAULT '3 hours')
RETURNS integer AS $$
DECLARE archived_count integer := 0;
BEGIN
  -- End any live game held by a room that has gone inactive, so the
  -- reviewer/stats stay consistent with the archived room.
  UPDATE games g
  SET ended_at = NOW()
  FROM rooms r
  WHERE g.room_id = r.id
    AND g.ended_at IS NULL
    AND r.status <> 'closed'
    AND r.last_activity_at < NOW() - max_age;

  -- Archive the inactive rooms themselves.
  WITH a AS (
    UPDATE rooms
    SET status = 'closed', last_activity_at = NOW()
    WHERE status <> 'closed'
      AND last_activity_at < NOW() - max_age
    RETURNING id
  )
  SELECT COUNT(*) INTO archived_count FROM a;
  RETURN archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION archive_expired_rooms IS
  'Archives rooms (status=closed) inactive beyond max_age (default 3 hours, by last_activity_at) and force-ends their live games. Spares active rooms/games.';

-- --------------------------------------------
-- Combined cron entrypoint. Uses the functions'' own defaults (single source of
-- the 1-day / 3-hour thresholds).
-- --------------------------------------------
CREATE OR REPLACE FUNCTION run_lifetime_cleanup()
RETURNS void AS $$
DECLARE g integer; r integer;
BEGIN
  SELECT end_zombie_games()      INTO g;
  SELECT archive_expired_rooms() INTO r;
  IF g > 0 OR r > 0 THEN
    RAISE NOTICE 'Lifetime cleanup: % zombie game(s) ended, % expired room(s) archived', g, r;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION run_lifetime_cleanup IS
  'pg_cron entrypoint: end_zombie_games() + archive_expired_rooms() at their default thresholds.';

-- Manual trigger for testing / one-off cleanup.
CREATE OR REPLACE FUNCTION manual_lifetime_cleanup()
RETURNS TABLE (zombie_games_ended integer, expired_rooms_archived integer) AS $$
BEGIN
  RETURN QUERY SELECT end_zombie_games(), archive_expired_rooms();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION manual_lifetime_cleanup IS
  'Run the lifetime cleanup on demand: SELECT * FROM manual_lifetime_cleanup();';

-- --------------------------------------------
-- Schedule every 15 minutes. Guarded so the migration still applies cleanly on
-- a stack where pg_cron is unavailable (the functions above remain callable
-- manually via manual_lifetime_cleanup()).
-- --------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lifetime-cleanup') THEN
      PERFORM cron.unschedule('lifetime-cleanup');
    END IF;
    PERFORM cron.schedule('lifetime-cleanup', '*/15 * * * *', 'SELECT run_lifetime_cleanup();');
  END IF;
END $$;

COMMIT;
