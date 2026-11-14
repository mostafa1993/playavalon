-- ============================================
-- Migration: 033_game_tables_server_only.sql
-- Date: 2026-11-14
-- Feature: the database API is server-only
--
-- The app reads and writes every table through its /api routes with the service
-- role; the browser and the bots never query a table or call a function. Yet the
-- public anon key, signed in or not, could:
--   - call every function in public through /rest/v1/rpc, the definer ones past
--     row security: cleanup_rooms with limits of the caller's choosing closes
--     every room, and closing a room ends its game;
--   - update the caller's own player_roles row, any column (role, special_role),
--     and own players row;
--   - read every players row, and the game_statistics view (it runs as its owner).
-- The read policies that go through room_players failed on their own recursion
-- (room_players' policy selects from room_players), so the other game tables were
-- closed only by that error. The browser's three realtime feeds never delivered a
-- change: they joined as anon, which no policy admits, or as the player, whose
-- policies failed on that recursion; the app no longer subscribes.
--
-- The rule from here on: anon and authenticated hold no privilege on anything in
-- public — no table, view, sequence or function — and no table has a policy.
-- Row-level security stays on, so opening a table takes both a GRANT and a
-- policy. Tables and functions that later migrations create (as postgres) start
-- with no privilege for anon and authenticated; turn row-level security on in the
-- migration that creates the table. Only the service role (the app's server, the
-- reviewer, the bot supervisor) and postgres (pg_cron) read, write and call them.
-- Create objects only in migrations: what Studio creates is owned by
-- supabase_admin, whose defaults (Supabase's, which postgres can't change) still
-- grant anon and authenticated everything.
-- ============================================

BEGIN;

-- Every policy on the public tables.
DROP POLICY "Room members read events" ON game_events;
DROP POLICY "Room members read games" ON games;
DROP POLICY "Room members read investigations" ON lady_investigations;
DROP POLICY "Room members read quiz votes" ON merlin_quiz_votes;
DROP POLICY "Players confirm own role" ON player_roles;
DROP POLICY "Players see own role" ON player_roles;
DROP POLICY "Authenticated users read profiles" ON players;
DROP POLICY "Users update own profile" ON players;
DROP POLICY "Members see room players" ON room_players;
DROP POLICY "Anyone sees waiting rooms" ON rooms;
DROP POLICY "Manager updates room" ON rooms;
DROP POLICY "Members see their room" ON rooms;
DROP POLICY "Room members read proposals" ON team_proposals;
DROP POLICY "Players read own vote" ON votes;
DROP POLICY "Room members read votes" ON votes;

-- Tables, views (game_statistics), sequences and functions as they stand.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Whatever later migrations create. Supabase's defaults for public grant anon and
-- authenticated by name; Postgres's own default lets PUBLIC run every new function,
-- in any schema, and a per-schema default can't take that away, so that one is
-- revoked for every function postgres creates. (Extensions are created by
-- supabase_admin on this stack, so their functions are unaffected.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- No client receives changes: the feeds are gone, and none could read the rows.
ALTER PUBLICATION supabase_realtime
  DROP TABLE rooms, room_players, merlin_quiz_votes, player_roles;

COMMIT;
