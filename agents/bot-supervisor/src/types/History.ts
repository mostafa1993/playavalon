/**
 * GameHistory — what GET /api/games/[gameId]/history returns: the game as
 * the table saw it (every proposal and, once revealed, every vote; every
 * quest's team and cards; who used the Lady on whom, and the result only for
 * the bot's own looks). Mirrors src/lib/domain/game-history.ts in the app.
 */

export interface HistoryProposal {
  quest: number;
  proposal_number: number;
  leader_id: string;
  team_member_ids: string[];
  status: 'pending' | 'approved' | 'rejected';
  /** Every player's vote once revealed; null while the proposal is voted on. */
  votes: Array<{ player_id: string; vote: 'approve' | 'reject' }> | null;
}

export interface HistoryQuest {
  quest: number;
  result: 'success' | 'fail';
  success_count: number;
  fail_count: number;
  team_member_ids: string[];
}

export interface HistoryLady {
  quest: number;
  investigator_id: string;
  target_id: string;
  /** The alignment seen — only when the bot was the one who looked. */
  result: 'good' | 'evil' | null;
}

export interface GameHistory {
  proposals: HistoryProposal[];
  quests: HistoryQuest[];
  lady: HistoryLady[];
}
