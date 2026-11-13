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
-- Nothing in the app reads game_reviews with a user's token, so the policy goes,
-- and 022's explicit SELECT grant to authenticated with it. What shuts the table
-- to browsers is row-level security with no policy (as for quest_actions):
-- Supabase's default privileges still grant anon and authenticated table rights,
-- so adding any policy later reopens it. Only the service role (the app's server
-- and the reviewer) reads or writes it.
-- ============================================

BEGIN;

DROP POLICY "Room members read game review status" ON game_reviews;

REVOKE SELECT ON public.game_reviews FROM authenticated;

COMMIT;
