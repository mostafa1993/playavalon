/**
 * Shared types for the AI Game Reviewer feature (022).
 * The agent writes summary JSON files with the shape below; the Next.js
 * review page and API route read them.
 */

export type ReviewStatus = 'pending' | 'recording' | 'generating' | 'ready' | 'failed';

export interface ReviewQuestProposal {
  proposal_number: number;
  team: string[];
  approvals: string[];
  rejections: string[];
  status: 'approved' | 'rejected';
}

export interface ReviewQuest {
  quest_number: number;
  leader_display_name: string;
  proposals: ReviewQuestProposal[];
  mission: null | {
    team: string[];
    success_count: number;
    fail_count: number;
    result: 'success' | 'fail';
  };
  narrative_summary: string;
  turning_points: string[];
  mvp: { player: string; reason: string } | null;
  suspicious_players: Array<{ player: string; reason: string }>;
  gameId: string;
  completedAt: string;
}

export interface ReviewDiscussionSpeaker {
  identity: string;
  display_name: string;
  durationSec: number;
  transcript: string;
  summary?: {
    key_points?: string[];
    notable_quotes?: string[];
    stance?: string;
    claims?: string[];
    suspicions?: Array<{ target: string; reason: string }>;
    defenses?: Array<{ subject: string; reason: string }>;
  };
}

export interface ReviewDiscussion {
  gameId: string;
  startedAt: string;
  durationSec: number;
  assassinDisplayName: string | null;
  speakers: ReviewDiscussionSpeaker[];
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

export interface ReviewPlayerPerformance {
  player: string;
  role: string;
  assessment: string;
}

interface ReviewSummaryCommon {
  language: 'fa' | 'en';
  gameId: string;
  roomCode: string;
  generatedAt: string;
  outcome: {
    winner: 'good' | 'evil' | null;
    win_reason: string | null;
    ended_at: string | null;
  };
  quests: ReviewQuest[];
  discussion?: ReviewDiscussion | null;
}

/** God mode: roles revealed + per-player performance. */
export interface GodReviewSummary extends ReviewSummaryCommon {
  mode: 'god';
  players: Array<{
    id: string;
    display_name: string;
    seat_number: number | null;
    role: 'good' | 'evil';
    special_role: string | null;
  }>;
  role_reveal: string;
  narrative: string;
  /** Optional: absent on reports generated before god performance shipped. */
  performance?: ReviewPlayerPerformance[];
}

/** Blind mode: evolving guesses + reasoning, never the role truth. */
export interface BlindReviewSummary extends ReviewSummaryCommon {
  mode: 'blind';
  players: Array<{
    id: string;
    display_name: string;
    seat_number: number | null;
  }>;
  guess_timeline: ReviewGuessRound[];
  final_guesses: ReviewRoleGuess[];
  final_summary: string;
}

/**
 * The review report. Discriminated by `mode`. Reports generated before this
 * feature have no `mode` field → they render through the god branch (they carry
 * role_reveal/narrative), which is correct since the old reviewer was god-only.
 */
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
        summary: ReviewSummary;
      };
    };
