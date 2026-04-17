/**
 * Unit tests for Merlin Quiz domain logic
 * Feature 010: Endgame Merlin Quiz
 */

import { describe, it, expect } from 'vitest';
import {
  QUIZ_TIMEOUT_SECONDS,
  canShowQuiz,
  hasPlayerVoted,
  validateQuizVote,
  isQuizComplete,
  calculateQuizResults,
} from '@/lib/domain/merlin-quiz';
import type { MerlinQuizVote, GamePlayer } from '@/types/game';

describe('merlin-quiz', () => {
  describe('QUIZ_TIMEOUT_SECONDS', () => {
    it('should be 60 seconds', () => {
      expect(QUIZ_TIMEOUT_SECONDS).toBe(60);
    });
  });

  describe('canShowQuiz', () => {
    it('should return true when Merlin is in game', () => {
      expect(canShowQuiz(true)).toBe(true);
    });

    it('should return false when Merlin is not in game', () => {
      expect(canShowQuiz(false)).toBe(false);
    });
  });

  describe('hasPlayerVoted', () => {
    const votes: MerlinQuizVote[] = [
      {
        id: 'vote-1',
        game_id: 'game-1',
        voter_player_id: 'player-1',
        suspected_player_id: 'player-2',
        submitted_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 'vote-2',
        game_id: 'game-1',
        voter_player_id: 'player-3',
        suspected_player_id: null, // skipped
        submitted_at: '2025-01-01T00:01:00Z',
      },
    ];

    it('should return true when player has voted', () => {
      expect(hasPlayerVoted(votes, 'player-1')).toBe(true);
    });

    it('should return true when player has skipped (null vote)', () => {
      expect(hasPlayerVoted(votes, 'player-3')).toBe(true);
    });

    it('should return false when player has not voted', () => {
      expect(hasPlayerVoted(votes, 'player-2')).toBe(false);
      expect(hasPlayerVoted(votes, 'player-unknown')).toBe(false);
    });

    it('should return false for empty votes array', () => {
      expect(hasPlayerVoted([], 'player-1')).toBe(false);
    });
  });

  describe('validateQuizVote', () => {
    const seatingOrder = ['player-1', 'player-2', 'player-3', 'player-4'];

    it('should return valid for voting for another player in game', () => {
      const result = validateQuizVote('player-1', 'player-2', seatingOrder);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid for skipping (null vote)', () => {
      const result = validateQuizVote('player-1', null, seatingOrder);
      expect(result.valid).toBe(true);
    });

    it('should return invalid when voting for self', () => {
      const result = validateQuizVote('player-1', 'player-1', seatingOrder);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('CANNOT_VOTE_SELF');
    });

    it('should return invalid when suspected player not in game', () => {
      const result = validateQuizVote('player-1', 'player-unknown', seatingOrder);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_PLAYER');
    });

    it('should return invalid when voter not in game', () => {
      const result = validateQuizVote('player-unknown', 'player-2', seatingOrder);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('VOTER_NOT_IN_GAME');
    });
  });

  describe('isQuizComplete', () => {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    const twoMinutesAgo = new Date(now.getTime() - 120000);
    const thirtySecondsAgo = new Date(now.getTime() - 30000);

    it('should return true when all connected players have voted', () => {
      expect(isQuizComplete(5, 5, oneMinuteAgo.toISOString())).toBe(true);
    });

    it('should return true when timeout exceeded', () => {
      expect(isQuizComplete(2, 5, twoMinutesAgo.toISOString())).toBe(true);
    });

    it('should return false when quiz just started and not all voted', () => {
      expect(isQuizComplete(2, 5, thirtySecondsAgo.toISOString())).toBe(false);
    });

    it('should return false when quiz has not started (null start time)', () => {
      expect(isQuizComplete(0, 5, null)).toBe(false);
    });

    it('should return true when no connected players (edge case)', () => {
      expect(isQuizComplete(0, 0, oneMinuteAgo.toISOString())).toBe(true);
    });
  });

  describe('calculateQuizResults', () => {
    const players: GamePlayer[] = [
      { id: 'player-1', display_name: 'Alice', seat_position: 0, is_leader: false, is_on_team: false, has_voted: false, is_connected: true },
      { id: 'player-2', display_name: 'Bob', seat_position: 1, is_leader: false, is_on_team: false, has_voted: false, is_connected: true },
      { id: 'player-3', display_name: 'Charlie', seat_position: 2, is_leader: false, is_on_team: false, has_voted: false, is_connected: true },
      { id: 'player-4', display_name: 'Diana', seat_position: 3, is_leader: false, is_on_team: false, has_voted: false, is_connected: true },
    ];

    it('should calculate vote counts correctly', () => {
      const votes: MerlinQuizVote[] = [
        { id: 'v1', game_id: 'g1', voter_player_id: 'player-1', suspected_player_id: 'player-2', submitted_at: '2025-01-01T00:00:00Z' },
        { id: 'v2', game_id: 'g1', voter_player_id: 'player-3', suspected_player_id: 'player-2', submitted_at: '2025-01-01T00:01:00Z' },
        { id: 'v3', game_id: 'g1', voter_player_id: 'player-4', suspected_player_id: 'player-1', submitted_at: '2025-01-01T00:02:00Z' },
      ];

      const result = calculateQuizResults(votes, players, 'player-3');

      // Check Bob has 2 votes (most voted)
      const bobResult = result.results!.find(r => r.player_id === 'player-2');
      expect(bobResult?.vote_count).toBe(2);
      expect(bobResult?.is_most_voted).toBe(true);

      // Check Alice has 1 vote
      const aliceResult = result.results!.find(r => r.player_id === 'player-1');
      expect(aliceResult?.vote_count).toBe(1);
      expect(aliceResult?.is_most_voted).toBe(false);

      // Check Charlie is actual Merlin
      const charlieResult = result.results!.find(r => r.player_id === 'player-3');
      expect(charlieResult?.vote_count).toBe(0);
      expect(charlieResult?.is_actual_merlin).toBe(true);

      expect(result.actual_merlin_id).toBe('player-3');
      expect(result.actual_merlin_display_name).toBe('Charlie');
    });

    it('should handle ties for most voted', () => {
      const votes: MerlinQuizVote[] = [
        { id: 'v1', game_id: 'g1', voter_player_id: 'player-1', suspected_player_id: 'player-2', submitted_at: '2025-01-01T00:00:00Z' },
        { id: 'v2', game_id: 'g1', voter_player_id: 'player-3', suspected_player_id: 'player-4', submitted_at: '2025-01-01T00:01:00Z' },
      ];

      const result = calculateQuizResults(votes, players, 'player-1');

      const bobResult = result.results!.find(r => r.player_id === 'player-2');
      const dianaResult = result.results!.find(r => r.player_id === 'player-4');

      // Both should be marked as most voted
      expect(bobResult?.is_most_voted).toBe(true);
      expect(dianaResult?.is_most_voted).toBe(true);
    });

    it('should handle skipped votes', () => {
      const votes: MerlinQuizVote[] = [
        { id: 'v1', game_id: 'g1', voter_player_id: 'player-1', suspected_player_id: 'player-2', submitted_at: '2025-01-01T00:00:00Z' },
        { id: 'v2', game_id: 'g1', voter_player_id: 'player-3', suspected_player_id: null, submitted_at: '2025-01-01T00:01:00Z' }, // skipped
        { id: 'v3', game_id: 'g1', voter_player_id: 'player-4', suspected_player_id: null, submitted_at: '2025-01-01T00:02:00Z' }, // skipped
      ];

      const result = calculateQuizResults(votes, players, 'player-1');

      expect(result.skipped_count).toBe(2);
      expect(result.total_votes).toBe(1); // Only non-skipped votes
    });

    it('should return empty results when no votes', () => {
      const result = calculateQuizResults([], players, 'player-1');

      expect(result.total_votes).toBe(0);
      expect(result.skipped_count).toBe(0);
      // All players should have 0 votes
      result.results!.forEach(r => {
        expect(r.vote_count).toBe(0);
      });
    });

    it('should sort results by vote count descending', () => {
      const votes: MerlinQuizVote[] = [
        { id: 'v1', game_id: 'g1', voter_player_id: 'player-1', suspected_player_id: 'player-3', submitted_at: '2025-01-01T00:00:00Z' },
        { id: 'v2', game_id: 'g1', voter_player_id: 'player-2', suspected_player_id: 'player-3', submitted_at: '2025-01-01T00:01:00Z' },
        { id: 'v3', game_id: 'g1', voter_player_id: 'player-4', suspected_player_id: 'player-2', submitted_at: '2025-01-01T00:02:00Z' },
      ];

      const result = calculateQuizResults(votes, players, 'player-1');

      // First result should be player-3 (Charlie) with 2 votes
      expect(result.results![0].player_id).toBe('player-3');
      expect(result.results![0].vote_count).toBe(2);

      // Second should be player-2 (Bob) with 1 vote
      expect(result.results![1].player_id).toBe('player-2');
      expect(result.results![1].vote_count).toBe(1);
    });
  });
});
