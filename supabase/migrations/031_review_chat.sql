-- ============================================
-- Migration: 031_review_chat.sql
-- Date: 2026-11-13
-- Feature: each player's chat with the AI reviewer about a finished game
--
-- One private thread per player per game. Only the app's server reads and
-- writes it (GET/POST /api/reviews/[gameId]/chat, with the service role).
-- Browsers have no access at all: every right of anon and authenticated is
-- revoked and row-level security is on with no policy, so opening it later
-- would take both a GRANT and a policy.
--
-- Each question gets the next number in its thread (turn_no), and its answer
-- carries the same number, so the thread reads back in pairs. The unique key
-- refuses a second question with the same number: two questions sent at once
-- cannot both be stored, which is what keeps the per-player question cap (a
-- number in the app's configuration) from being passed by parallel requests.
-- ============================================

BEGIN;

CREATE TABLE review_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  turn_no     integer NOT NULL CHECK (turn_no >= 1),
  speaker     text NOT NULL CHECK (speaker IN ('player', 'reviewer')),
  content     text NOT NULL CHECK (length(content) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, player_id, turn_no, speaker)
);

ALTER TABLE review_chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.review_chat_messages FROM anon, authenticated;
GRANT ALL ON public.review_chat_messages TO service_role;

COMMIT;
