import { describe, it, expect } from 'vitest';
import { playedInGame } from '@/lib/domain/game-membership';

describe('playedInGame', () => {
  const game = { seating_order: ['p1', 'p2', 'p3', 'p4', 'p5'] };

  it('is true for a player in the seating order', () => {
    expect(playedInGame(game, 'p3')).toBe(true);
  });

  it('is false for a player not in the seating order', () => {
    expect(playedInGame(game, 'outsider')).toBe(false);
  });

  it('is false for an empty seating order', () => {
    expect(playedInGame({ seating_order: [] }, 'p1')).toBe(false);
  });
});
