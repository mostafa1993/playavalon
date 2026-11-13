/**
 * Unit tests for win condition logic
 * Tests checkWinConditions and getWinReasonText with and without Merlin
 */

import { describe, it, expect } from 'vitest';
import { checkWinConditions, getWinReasonText } from '@/lib/domain/win-conditions';
import type { QuestResult } from '@/types/game';

function questResults(...outcomes: Array<'success' | 'fail'>): QuestResult[] {
  return outcomes.map((result, i) => ({
    quest: i + 1,
    result,
    success_count: result === 'success' ? 2 : 1,
    fail_count: result === 'success' ? 0 : 1,
    team_member_ids: [],
    completed_at: '2026-11-13T00:00:00.000Z',
  }));
}

describe('checkWinConditions', () => {
  describe('with Merlin', () => {
    it('starts the assassin phase after 3 successes instead of ending the game', () => {
      const result = checkWinConditions(questResults('success', 'fail', 'success', 'success'), 0, true);
      expect(result).toEqual({ gameOver: false, assassinPhase: true, winner: null, reason: null });
    });

    it('gives Evil the win after 3 failures', () => {
      const result = checkWinConditions(questResults('fail', 'success', 'fail', 'fail'), 0, true);
      expect(result).toEqual({ gameOver: true, assassinPhase: false, winner: 'evil', reason: '3_quest_failures' });
    });
  });

  describe('without Merlin', () => {
    it('gives Good the win at once after 3 successes, with no assassin phase', () => {
      const result = checkWinConditions(questResults('success', 'success', 'success'), 0, false);
      expect(result).toEqual({ gameOver: true, assassinPhase: false, winner: 'good', reason: '3_quest_successes' });
    });

    it('gives Evil the win after 3 failures', () => {
      const result = checkWinConditions(questResults('fail', 'fail', 'success', 'fail'), 0, false);
      expect(result).toEqual({ gameOver: true, assassinPhase: false, winner: 'evil', reason: '3_quest_failures' });
    });

    it('gives Evil the win after 5 rejections', () => {
      const result = checkWinConditions(questResults('success', 'success'), 5, false);
      expect(result).toEqual({ gameOver: true, assassinPhase: false, winner: 'evil', reason: '5_rejections' });
    });

    it('continues the game with fewer than 3 of either', () => {
      const result = checkWinConditions(questResults('success', 'fail', 'success', 'fail'), 4, false);
      expect(result).toEqual({ gameOver: false, assassinPhase: false, winner: null, reason: null });
    });
  });
});

describe('getWinReasonText', () => {
  it('names the Assassin and Merlin for a Good win when Merlin was dealt', () => {
    expect(getWinReasonText('3_quest_successes', true)).toBe(
      'Good completed 3 successful quests! The Assassin failed to find Merlin.'
    );
  });

  it('names neither the Assassin nor Merlin for a Good win without Merlin', () => {
    const text = getWinReasonText('3_quest_successes', false);
    expect(text).toBe('Good completed 3 successful quests!');
    expect(text).not.toMatch(/Merlin|Assassin/);
  });

  it('names neither for Evil wins without Merlin', () => {
    expect(getWinReasonText('3_quest_failures', false)).not.toMatch(/Merlin|Assassin/);
    expect(getWinReasonText('5_rejections', false)).not.toMatch(/Merlin|Assassin/);
  });
});
