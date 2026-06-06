-- ============================================
-- Migration: 023_intro_phase.sql
-- Feature: One-time introduction round at game start
-- ============================================
--
-- Adds support for an optional "intro round" that runs once at the start
-- of every game (before Quest 1's first proposal). During the intro, the
-- first leader speaks without proposing, others discuss in order, and the
-- leader speaks at the end. After the manager ends the intro, the same
-- leader proceeds to propose Quest 1's team normally.
--
-- Storage:
--   rooms.intro_phase_enabled  — config flag set at room creation, immutable
--   games.in_intro_phase       — current runtime state, flips to false when
--                                 the manager ends the intro
--
-- Following the lady_of_lake_enabled pattern (own column, not role_config)
-- since this is a game-mode toggle, not a role configuration.

BEGIN;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS intro_phase_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS in_intro_phase BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN rooms.intro_phase_enabled IS
  'If true, this room plays a one-time intro round at game start where the first leader speaks without proposing a team. Set at room creation, never modified during play.';

COMMENT ON COLUMN games.in_intro_phase IS
  'True while this game is in the intro phase (between game start and the manager pressing End Intro). False after intro completes, or always false if intro_phase_enabled was off on the room. The propose endpoint refuses calls while this is true.';

COMMIT;
