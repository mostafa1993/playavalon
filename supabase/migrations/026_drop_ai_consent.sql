-- Remove AI Game Reviewer consent gate
-- Migration: 026_drop_ai_consent.sql
-- Date: 2026-06-27
-- Feature: 022-ai-game-reviewer (consent removed)
--
-- Players no longer individually consent to the AI Game Review. The manager
-- toggle (rooms.ai_review_enabled / ai_review_mode) and game_reviews stay.
-- DROP TABLE CASCADE also removes the index and RLS policies on this table.

BEGIN;

DROP TABLE IF EXISTS room_ai_consents CASCADE;

COMMIT;
