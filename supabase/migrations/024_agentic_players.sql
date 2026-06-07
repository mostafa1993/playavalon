-- ============================================
-- Migration: 024_agentic_players.sql
-- Feature: Production integration of rule-based agentic players (Phase 4)
-- ============================================
--
-- Two columns added to support automatic bot fill-in at room creation:
--
--   rooms.agent_count       — set at room creation. The bot-supervisor
--                              service watches for rooms with agent_count > 0
--                              and spawns N agent processes to fill those
--                              seats. Default 0 = behavior unchanged from
--                              before this migration.
--
--   room_players.is_bot     — set true when a bot account joins via the
--                              agent engine. Used by the lobby + game UI to
--                              render a 🤖 badge so humans can see who's a
--                              bot vs another human.
--
-- The supervisor is a separate Node service (`bot-supervisor` in
-- docker-compose.yml, profiles: [prod]). The game's server-side code
-- doesn't spawn anything — it just records the desired count, and the
-- supervisor watches the table and acts.

BEGIN;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS agent_count INT NOT NULL DEFAULT 0
    CHECK (agent_count >= 0);

ALTER TABLE room_players
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN rooms.agent_count IS
  'Number of bot players that should auto-fill empty seats. Default 0 = no bots. The bot-supervisor service polls for rooms with this > 0 and spawns the matching agent processes from the agents/ workspace, picking bots by the `order` field in each agents/configs/<name>.yaml.';

COMMENT ON COLUMN room_players.is_bot IS
  'True if this room_players row belongs to a bot (auto-played by an agent process). The agent engine sets this to true when joining a room. Used by the UI to render a 🤖 badge.';

COMMIT;
