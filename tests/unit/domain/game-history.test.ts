import { describe, expect, it } from 'vitest';
import { buildGameHistory } from '@/lib/domain/game-history';
import type { LadyInvestigation, QuestResult, TeamProposal } from '@/types/game';

const proposal = (over: Partial<TeamProposal>): TeamProposal => ({
  id: 'p',
  game_id: 'g',
  quest_number: 1,
  proposal_number: 1,
  leader_id: 'a',
  team_member_ids: ['a', 'b'],
  status: 'approved',
  approve_count: 0,
  reject_count: 0,
  created_at: '2026-11-15T10:00:00Z',
  resolved_at: '2026-11-15T10:05:00Z',
  ...over,
});

const quest = (n: number, result: 'success' | 'fail'): QuestResult => ({
  quest: n,
  result,
  success_count: result === 'success' ? 2 : 1,
  fail_count: result === 'success' ? 0 : 1,
  team_member_ids: ['a', 'b'],
  completed_at: '2026-11-15T10:06:00Z',
});

const lady = (investigator: string, target: string, at: string): LadyInvestigation => ({
  id: `${investigator}-${target}`,
  game_id: 'g',
  quest_number: 2,
  investigator_id: investigator,
  target_id: target,
  result: 'evil',
  created_at: at,
});

describe('buildGameHistory', () => {
  it('lists proposals in order with their revealed votes', () => {
    const history = buildGameHistory({
      proposals: [
        proposal({ id: 'p2', quest_number: 1, proposal_number: 2 }),
        proposal({ id: 'p1', quest_number: 1, proposal_number: 1, status: 'rejected' }),
      ],
      votes: [
        { proposal_id: 'p1', player_id: 'a', vote: 'approve' },
        { proposal_id: 'p1', player_id: 'b', vote: 'reject' },
        { proposal_id: 'p2', player_id: 'a', vote: 'approve' },
      ],
      questResults: [],
      investigations: [],
      viewerId: 'a',
    });
    expect(history.proposals.map((p) => [p.proposal_number, p.status])).toEqual([
      [1, 'rejected'],
      [2, 'approved'],
    ]);
    expect(history.proposals[0].votes).toEqual([
      { player_id: 'a', vote: 'approve' },
      { player_id: 'b', vote: 'reject' },
    ]);
    expect(history.proposals[1].votes).toEqual([{ player_id: 'a', vote: 'approve' }]);
  });

  it('keeps the votes of a proposal still being voted on secret', () => {
    const history = buildGameHistory({
      proposals: [proposal({ id: 'p1', status: 'pending', resolved_at: null })],
      votes: [{ proposal_id: 'p1', player_id: 'a', vote: 'approve' }],
      questResults: [],
      investigations: [],
      viewerId: 'a',
    });
    expect(history.proposals[0].votes).toBeNull();
  });

  it('orders the quests', () => {
    const history = buildGameHistory({
      proposals: [],
      votes: [],
      questResults: [quest(2, 'fail'), quest(1, 'success')],
      investigations: [],
      viewerId: 'a',
    });
    expect(history.quests.map((q) => [q.quest, q.result])).toEqual([
      [1, 'success'],
      [2, 'fail'],
    ]);
  });

  it('shows a Lady result only to the player who looked', () => {
    const investigations = [
      lady('b', 'c', '2026-11-15T10:20:00Z'),
      lady('a', 'b', '2026-11-15T10:10:00Z'),
    ];
    const forA = buildGameHistory({ proposals: [], votes: [], questResults: [], investigations, viewerId: 'a' });
    expect(forA.lady).toEqual([
      { quest: 2, investigator_id: 'a', target_id: 'b', result: 'evil' },
      { quest: 2, investigator_id: 'b', target_id: 'c', result: null },
    ]);
    const forC = buildGameHistory({ proposals: [], votes: [], questResults: [], investigations, viewerId: 'c' });
    expect(forC.lady.every((l) => l.result === null)).toBe(true);
  });
});
