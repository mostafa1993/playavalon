import { describe, it, expect } from 'vitest';
import { publicGame } from '@/lib/domain/public-game';
import type { Game } from '@/types/game';

describe('publicGame', () => {
  it('drops every hidden column and keeps the rest', () => {
    const game = {
      id: 'g1',
      phase: 'team_building',
      seating_order: ['a', 'b', 'c', 'd', 'e'],
      merlin_decoy_player_id: 'a',
      split_intel_certain_evil_ids: ['b'],
      split_intel_mixed_evil_id: 'c',
      split_intel_mixed_good_id: 'd',
      oberon_split_intel_certain_evil_ids: ['b'],
      oberon_split_intel_mixed_good_id: 'd',
      evil_ring_assignments: { b: 'c' },
    } as unknown as Game;
    const out = publicGame(game) as Record<string, unknown>;
    for (const hidden of [
      'merlin_decoy_player_id',
      'split_intel_certain_evil_ids',
      'split_intel_mixed_evil_id',
      'split_intel_mixed_good_id',
      'oberon_split_intel_certain_evil_ids',
      'oberon_split_intel_mixed_good_id',
      'evil_ring_assignments',
    ]) {
      expect(out).not.toHaveProperty(hidden);
    }
    expect(out).toMatchObject({ id: 'g1', phase: 'team_building', seating_order: ['a', 'b', 'c', 'd', 'e'] });
  });
});
