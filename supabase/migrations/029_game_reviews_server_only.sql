-- ============================================
-- Migration: 029_game_reviews_server_only.sql
-- Date: 2026-11-13
-- Feature: who may read an AI game review
--
-- A review belongs to the players of its game: everyone in games.seating_order.
-- The app checks exactly that in GET /api/reviews/[gameId], which reads
-- game_reviews with the service role. 022 also let signed-in browsers read
-- game_reviews directly, through a policy keyed on current room membership — a
-- second, different rule: creating a room deletes a player's membership of their
-- finished game's room, so it refused real players and admitted whoever was in
-- the room instead, and it exposed the summary file paths and raw error text.
-- Nothing in the app reads or writes game_reviews with a user's token, so the
-- policy goes, and with it every right of anon and authenticated (Supabase's
-- default privileges had given them all). Row-level security stays on with no
-- policy, so opening the table later would take both a GRANT and a policy.
-- Only the service role (the app's server and the reviewer) reads or writes it.
-- ============================================

BEGIN;

DROP POLICY "Room members read game review status" ON game_reviews;

REVOKE ALL ON public.game_reviews FROM anon, authenticated;

COMMIT;
