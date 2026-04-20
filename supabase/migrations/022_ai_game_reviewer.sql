-- AI Game Reviewer: opt-in post-game summary agent
-- Migration: 022_ai_game_reviewer.sql
-- Date: 2026-04-19
-- Feature: 022-ai-game-reviewer

BEGIN;

-- ============================================
-- rooms.ai_review_enabled
-- ============================================
-- Manager-controlled toggle. When true, every player must consent
-- before the manager can distribute roles.

ALTER TABLE rooms
  ADD COLUMN ai_review_enabled boolean NOT NULL DEFAULT false;

-- ============================================
-- room_ai_consents
-- ============================================
-- Per-player consent for a given room. Cleared whenever the manager
-- toggles ai_review_enabled (either direction) so consent must be
-- re-collected for each cycle.

CREATE TABLE room_ai_consents (
  room_id     uuid REFERENCES rooms(id)   ON DELETE CASCADE,
  player_id   uuid REFERENCES players(id) ON DELETE CASCADE,
  accepted    boolean     NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id)
);

CREATE INDEX idx_room_ai_consents_room ON room_ai_consents(room_id);

-- ============================================
-- game_reviews
-- ============================================
-- Lightweight status record for the AI reviewer's output.
-- Transcripts, dossiers, and final narratives live on disk under
-- /data/games/<game_id>/; only status + paths live here.

CREATE TABLE game_reviews (
  game_id         uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('pending','recording','generating','ready','failed')),
  summary_fa_path text,
  summary_en_path text,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- RLS
-- ============================================

ALTER TABLE room_ai_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_reviews     ENABLE ROW LEVEL SECURITY;

-- room_ai_consents: room members can read all consents in their room; a player
-- can only insert/update their own consent, and only in rooms they are a member of.
CREATE POLICY "Room members read consents in their room"
  ON room_ai_consents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM room_players rp
      WHERE rp.room_id = room_ai_consents.room_id
        AND rp.player_id = auth.uid()
    )
  );

CREATE POLICY "Members insert own consent"
  ON room_ai_consents
  FOR INSERT
  WITH CHECK (
    player_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM room_players rp
      WHERE rp.room_id = room_ai_consents.room_id
        AND rp.player_id = auth.uid()
    )
  );

CREATE POLICY "Members update own consent"
  ON room_ai_consents
  FOR UPDATE
  USING (player_id = auth.uid())
  WITH CHECK (
    player_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM room_players rp
      WHERE rp.room_id = room_ai_consents.room_id
        AND rp.player_id = auth.uid()
    )
  );

-- game_reviews: members of the game's room can read; writes are service-role only.
CREATE POLICY "Room members read game review status"
  ON game_reviews
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM games g
      JOIN room_players rp ON rp.room_id = g.room_id
      WHERE g.id = game_reviews.game_id
        AND rp.player_id = auth.uid()
    )
  );

COMMIT;
