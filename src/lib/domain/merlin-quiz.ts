/**
 * Merlin Quiz domain logic
 * Feature 010: Endgame Merlin Quiz
 *
 * Pure business logic for the end-of-game Merlin guessing quiz.
 * Quiz only appears at game_over phase when Merlin was in the game.
 */

import type {
  MerlinQuizVote,
  MerlinQuizResults,
  MerlinQuizResultEntry,
  MerlinQuizVoteBreakdownEntry,
  GamePlayer,
} from '@/types/game';

/**
 * Quiz timeout in seconds
 */
export const QUIZ_TIMEOUT_SECONDS = 60;

/**
 * Check if quiz should be shown
 * Quiz only appears when Merlin was in the game
 */
export function canShowQuiz(hasMerlin: boolean): boolean {
  return hasMerlin;
}

/**
 * Check if a player has already voted in the quiz
 */
export function hasPlayerVoted(votes: MerlinQuizVote[], playerId: string): boolean {
  return votes.some(vote => vote.voter_player_id === playerId);
}

/**
 * Validation result for quiz vote
 */
export interface QuizVoteValidation {
  valid: boolean;
  error?: 'CANNOT_VOTE_SELF' | 'INVALID_PLAYER' | 'VOTER_NOT_IN_GAME';
}

/**
 * Validate a quiz vote
 * - Player cannot vote for themselves
 * - Suspected player must be in the game (in seating order)
 * - Voter must be in the game
 * - Null vote (skip) is always valid if voter is in game
 */
export function validateQuizVote(
  voterId: string,
  suspectedId: string | null,
  seatingOrder: string[]
): QuizVoteValidation {
  // Voter must be in the game
  if (!seatingOrder.includes(voterId)) {
    return { valid: false, error: 'VOTER_NOT_IN_GAME' };
  }

  // Null vote (skip) is valid
  if (suspectedId === null) {
    return { valid: true };
  }

  // Cannot vote for self
  if (voterId === suspectedId) {
    return { valid: false, error: 'CANNOT_VOTE_SELF' };
  }

  // Suspected player must be in game
  if (!seatingOrder.includes(suspectedId)) {
    return { valid: false, error: 'INVALID_PLAYER' };
  }

  return { valid: true };
}

/**
 * Check if quiz is complete
 * Quiz completes when:
 * 1. All connected players have voted/skipped, OR
 * 2. Timeout (60 seconds) has elapsed since first vote
 */
export function isQuizComplete(
  votesSubmitted: number,
  connectedPlayers: number,
  quizStartedAt: string | null
): boolean {
  // If no one has voted yet, quiz hasn't started
  if (quizStartedAt === null) {
    return false;
  }

  // All connected players voted
  if (votesSubmitted >= connectedPlayers) {
    return true;
  }

  // Check timeout
  const startTime = new Date(quizStartedAt).getTime();
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;

  return elapsedSeconds >= QUIZ_TIMEOUT_SECONDS;
}

/**
 * Calculate remaining time in seconds
 * Returns 0 if quiz hasn't started or timeout exceeded
 */
export function getRemainingSeconds(quizStartedAt: string | null): number {
  if (quizStartedAt === null) {
    return QUIZ_TIMEOUT_SECONDS;
  }

  const startTime = new Date(quizStartedAt).getTime();
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;
  const remaining = QUIZ_TIMEOUT_SECONDS - elapsedSeconds;

  return Math.max(0, Math.floor(remaining));
}

/**
 * Calculate quiz results
 * Aggregates votes by suspected player and identifies most voted
 */
export function calculateQuizResults(
  votes: MerlinQuizVote[],
  players: GamePlayer[],
  merlinId: string
): MerlinQuizResults {
  // Count votes per player
  const voteCounts = new Map<string, number>();
  let skippedCount = 0;

  // Initialize all players with 0 votes
  players.forEach(player => {
    voteCounts.set(player.id, 0);
  });

  // Count votes
  votes.forEach(vote => {
    if (vote.suspected_player_id === null) {
      skippedCount++;
    } else {
      const current = voteCounts.get(vote.suspected_player_id) ?? 0;
      voteCounts.set(vote.suspected_player_id, current + 1);
    }
  });

  // Find max vote count
  const maxVotes = Math.max(...Array.from(voteCounts.values()), 0);

  // Build results
  const results: MerlinQuizResultEntry[] = players.map(player => ({
    player_id: player.id,
    display_name: player.display_name,
    vote_count: voteCounts.get(player.id) ?? 0,
    is_most_voted: maxVotes > 0 && (voteCounts.get(player.id) ?? 0) === maxVotes,
    is_actual_merlin: player.id === merlinId,
  }));

  // Sort by vote count descending
  results.sort((a, b) => b.vote_count - a.vote_count);

  // Find actual Merlin
  const merlin = players.find(p => p.id === merlinId);

  // Per-voter breakdown, ordered by submission time so it reads chronologically
  const playerById = new Map(players.map(p => [p.id, p]));
  const vote_breakdown: MerlinQuizVoteBreakdownEntry[] = [...votes]
    .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())
    .map(v => ({
      voter_id: v.voter_player_id,
      voter_display_name: playerById.get(v.voter_player_id)?.display_name ?? 'Unknown',
      suspected_player_id: v.suspected_player_id,
      suspected_display_name: v.suspected_player_id
        ? playerById.get(v.suspected_player_id)?.display_name ?? 'Unknown'
        : null,
    }));

  return {
    quiz_complete: true,
    results,
    actual_merlin_id: merlinId,
    actual_merlin_display_name: merlin?.display_name ?? 'Unknown',
    total_votes: votes.length - skippedCount,
    skipped_count: skippedCount,
    vote_breakdown,
  };
}

/**
 * Get player's vote status from votes array
 */
export function getPlayerVoteStatus(
  votes: MerlinQuizVote[],
  playerId: string
): { hasVoted: boolean; hasSkipped: boolean; votedFor: string | null } {
  const vote = votes.find(v => v.voter_player_id === playerId);

  if (!vote) {
    return { hasVoted: false, hasSkipped: false, votedFor: null };
  }

  if (vote.suspected_player_id === null) {
    return { hasVoted: true, hasSkipped: true, votedFor: null };
  }

  return { hasVoted: true, hasSkipped: false, votedFor: vote.suspected_player_id };
}
