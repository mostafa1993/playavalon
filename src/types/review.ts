/**
 * Shared types for the AI Game Reviewer feature (022).
 *
 * The agent writes one summary JSON file per language (`SummaryJson` in
 * agents/reviewer/src/types.ts, mirrored here); the API route serves it as it
 * is, and the review page maps it to its sections with `summaryView`
 * (src/lib/review/summary-view.ts). The facts in it are the game record's
 * own — roles (god mode), leaders, teams, votes, missions, Lady of the Lake,
 * the assassin's pick — and the model wrote only the narrative, the per-quest
 * commentary and (god mode) the performance notes.
 */

import type { SpecialRole } from './database';

export type ReviewStatus = 'pending' | 'recording' | 'generating' | 'ready' | 'failed';

/** The one summary format the page reads. A summary without it, or with
 *  another, shows "This report is no longer available". */
export const REVIEW_SUMMARY_FORMAT = 2;

// ── The record, as the summary carries it (without the turns' talk) ─────────

export interface ReviewRecordPlayer {
  id: string;
  display_name: string;
  /** Seat 1 led the first proposal; then clockwise. */
  seat_number: number;
}

/** God mode: the seat with its true role. */
export interface GodReviewRecordPlayer extends ReviewRecordPlayer {
  role: 'good' | 'evil';
  special_role: SpecialRole | null;
}

export interface ReviewRecordProposal {
  quest: number;
  proposalNumber: number;
  leaderId: string;
  teamIds: string[];
  status: 'pending' | 'approved' | 'rejected';
  /** In seat order; empty while pending. */
  votes: Array<{ playerId: string; vote: 'approve' | 'reject' }>;
}

export interface ReviewRecordMission {
  quest: number;
  teamIds: string[];
  successCount: number;
  failCount: number;
  result: 'success' | 'fail';
}

/** Lady of the Lake, used after `quest`'s mission. */
export interface ReviewRecordLadyUse {
  quest: number;
  investigatorId: string;
  targetId: string;
}

/** God mode: what the investigator saw. */
export interface GodReviewRecordLadyUse extends ReviewRecordLadyUse {
  result: 'good' | 'evil';
}

export interface ReviewRecordDiscussion {
  startedAt: string;
  durationSec: number;
  speakers: Array<{
    speakerId: string;
    transcript: string;
    confidence: number | null;
    durationSec: number;
  }>;
}

interface ReviewRecordCommon {
  gameId: string;
  /** By quest, then proposal number. */
  proposals: ReviewRecordProposal[];
  missions: ReviewRecordMission[];
  assassinPickId: string | null;
  outcome: {
    winner: 'good' | 'evil' | null;
    win_reason: string | null;
    ended_at: string | null;
  } | null;
  /** The assassin-phase discussion; null when there was none. */
  discussion: ReviewRecordDiscussion | null;
}

export interface GodReviewRecord extends ReviewRecordCommon {
  mode: 'god';
  players: GodReviewRecordPlayer[];
  lady: GodReviewRecordLadyUse[];
}

/** Blind mode: public play only — no role, no Lady result. */
export interface BlindReviewRecord extends ReviewRecordCommon {
  mode: 'blind';
  players: ReviewRecordPlayer[];
  lady: ReviewRecordLadyUse[];
}

// ── The model's part ────────────────────────────────────────────────────────

export interface ReviewQuestCommentary {
  quest: number;
  commentary: string;
}

export interface ReviewPlayerPerformance {
  playerId: string;
  assessment: string;
}

export interface ReviewRoleGuess {
  player: string;
  guessed_role: string;
  confidence: 'low' | 'med' | 'high';
  reasoning: string;
}

export interface ReviewGuessRound {
  round: number;
  quest: number;
  proposal_round: number;
  guesses: ReviewRoleGuess[];
}

// ── The summary ─────────────────────────────────────────────────────────────

interface ReviewSummaryCommon {
  format: typeof REVIEW_SUMMARY_FORMAT;
  language: 'fa' | 'en';
  gameId: string;
  roomCode: string;
  generatedAt: string;
  narrative: string;
  quest_commentary: ReviewQuestCommentary[];
}

/** God mode: the roles and a performance note per player. */
export interface GodReviewSummary extends ReviewSummaryCommon {
  mode: 'god';
  record: GodReviewRecord;
  performance: ReviewPlayerPerformance[];
}

/** Blind mode: the detective's guesses, never a role. */
export interface BlindReviewSummary extends ReviewSummaryCommon {
  mode: 'blind';
  record: BlindReviewRecord;
  guess_timeline: ReviewGuessRound[];
  final_guesses: ReviewRoleGuess[];
}

export type ReviewSummary = GodReviewSummary | BlindReviewSummary;

export type ReviewApiResponse =
  | { data: { enabled: false; status: null } }
  | {
      data: {
        enabled: true;
        status: Exclude<ReviewStatus, 'ready'>;
        error_message?: string | null;
        updated_at?: string;
      };
    }
  | {
      data: {
        enabled: true;
        status: 'ready';
        language: 'fa' | 'en';
        /** The file as the agent wrote it, in whatever format: the page reads
         *  it through `summaryView`, which accepts only REVIEW_SUMMARY_FORMAT. */
        summary: unknown;
      };
    };
