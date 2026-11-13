-- ============================================
-- Migration: 030_optional_merlin.sql
-- Date: 2026-11-13
-- Feature: the room's creator can play without Merlin
--
-- A room's setup (rooms.role_config) now states whether Merlin is in the game:
-- "merlin": true deals Merlin and the Assassin; "merlin": false deals neither
-- (the Assassin's seat is a plain Minion of Mordred) and Good wins on its third
-- successful quest. Until now Merlin and the Assassin were always dealt, an
-- empty setup meant exactly that, and the column was nullable with default '{}'.
-- No meaning hangs on a missing key any more:
--   1. Every room's setup gets "merlin": true, which is what it played with
--      (a NULL setup becomes {"merlin": true}).
--   2. The column becomes NOT NULL with no default, so every insert states its
--      setup. The app refuses a setup whose merlin is not true or false.
-- ============================================

BEGIN;

UPDATE rooms
SET role_config = COALESCE(role_config, '{}'::jsonb) || '{"merlin": true}'::jsonb;

ALTER TABLE rooms ALTER COLUMN role_config DROP DEFAULT;
ALTER TABLE rooms ALTER COLUMN role_config SET NOT NULL;

COMMENT ON COLUMN rooms.role_config IS 'JSONB setup of the game''s roles. Required key merlin (boolean): true deals Merlin and the Assassin, false deals neither (the Assassin''s seat is a Minion) and Good wins on 3 successful quests. Optional: percival, morgana, mordred, oberon (standard/chaos), lunatic, brute, ladyOfLake, merlin_decoy_enabled, merlin_split_intel_enabled, oberon_split_intel_enabled, evil_ring_visibility_enabled. Role distribution adds _-prefixed keys (decoy, split intel groups, evil ring).';

COMMIT;
