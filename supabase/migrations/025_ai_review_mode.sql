-- AI Reviewer mode: blind vs god
-- Migration: 025_ai_review_mode.sql
-- Feature: blind/god reviewer modes (see docs/ai-reviewer-modes-plan.md)

BEGIN;

-- ============================================
-- rooms.ai_review_mode
-- ============================================
-- Picked by the manager when enabling the AI reviewer (rooms.ai_review_enabled).
-- Only meaningful while ai_review_enabled = true.
--   blind = reviewer never reads player_roles; deduces roles from public play,
--           guessing incrementally each round (active detective).
--   god   = reviewer knows the roles; reveals them + evaluates performance.

ALTER TABLE rooms
  ADD COLUMN ai_review_mode text NOT NULL DEFAULT 'blind'
    CHECK (ai_review_mode IN ('blind','god'));

COMMIT;
