/**
 * A game's public history, as the table saw it: every proposal with its
 * leader and team, how each player voted once the votes were revealed, every
 * quest's team and cards, and who used the Lady of the Lake on whom.
 *
 * Two things are left out because the table never saw them: the votes on a
 * proposal still being voted on (secret until the reveal), and a Lady result
 * for anyone but the player who looked.
 *
 * The smart bots read it (GET /api/games/[gameId]/history), so a bot knows
 * what an attentive player at the table knows, and keeps knowing it after a
 * restart.
 */

import type {
  LadyInvestigation,
  ProposalStatus,
  QuestResult,
  TeamProposal,
  VoteChoice,
} from '@/types/game';

export interface HistoryProposal {
  quest: number;
  proposal_number: number;
  leader_id: string;
  team_member_ids: string[];
  status: ProposalStatus;
  /** Every player's vote once revealed; null while the proposal is voted on. */
  votes: Array<{ player_id: string; vote: VoteChoice }> | null;
}

export interface HistoryLady {
  quest: number;
  investigator_id: string;
  target_id: string;
  /** The alignment seen — only in the history of the player who looked. */
  result: 'good' | 'evil' | null;
}

export interface GameHistory {
  proposals: HistoryProposal[];
  quests: QuestResult[];
  lady: HistoryLady[];
}

export function buildGameHistory(input: {
  proposals: TeamProposal[];
  /** Votes of resolved proposals, by proposal id. */
  votes: Array<{ proposal_id: string; player_id: string; vote: VoteChoice }>;
  questResults: QuestResult[];
  investigations: LadyInvestigation[];
  viewerId: string;
}): GameHistory {
  const votesByProposal = new Map<string, Array<{ player_id: string; vote: VoteChoice }>>();
  for (const v of input.votes) {
    const list = votesByProposal.get(v.proposal_id) ?? [];
    list.push({ player_id: v.player_id, vote: v.vote });
    votesByProposal.set(v.proposal_id, list);
  }

  const proposals = [...input.proposals]
    .sort((a, b) => a.quest_number - b.quest_number || a.proposal_number - b.proposal_number)
    .map((p) => ({
      quest: p.quest_number,
      proposal_number: p.proposal_number,
      leader_id: p.leader_id,
      team_member_ids: p.team_member_ids,
      status: p.status,
      votes: p.status === 'pending' ? null : (votesByProposal.get(p.id) ?? []),
    }));

  const quests = [...input.questResults].sort((a, b) => a.quest - b.quest);

  const lady = [...input.investigations]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((i) => ({
      quest: i.quest_number,
      investigator_id: i.investigator_id,
      target_id: i.target_id,
      result: i.investigator_id === input.viewerId ? i.result : null,
    }));

  return { proposals, quests, lady };
}
