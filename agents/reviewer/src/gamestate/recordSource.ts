/**
 * Where the game record's rows come from: the database (the reviewer's
 * service-role client), or an export file of the same rows.
 *
 * The source splits public play from private play. `roles` and `ladyResults`
 * are private and read in god mode only; every other method is public. Nothing
 * here reads `quest_actions` (who played a fail card), in any mode.
 */

import fs from 'node:fs/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuestResultRow {
  quest: number;
  result: 'success' | 'fail';
  success_count: number;
  fail_count: number;
  team_member_ids: string[];
  completed_at: string;
}

/** The `games` columns the record reads. */
export interface GameRow {
  id: string;
  room_id: string;
  seating_order: string[];
  current_leader_id: string;
  quest_results: QuestResultRow[];
  assassin_guess_id: string | null;
  winner: 'good' | 'evil' | null;
  win_reason: string | null;
  ended_at: string | null;
}

export interface PlayerRow {
  id: string;
  display_name: string;
}

export interface ProposalRow {
  id: string;
  quest_number: number;
  proposal_number: number;
  leader_id: string;
  team_member_ids: string[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at: string | null;
}

export interface VoteRow {
  proposal_id: string;
  player_id: string;
  vote: 'approve' | 'reject';
}

/** A Lady of the Lake use as every player saw it. */
export interface LadyUseRow {
  quest_number: number;
  investigator_id: string;
  target_id: string;
}

/** Private: the result only the investigator saw. */
export interface LadyResultRow extends LadyUseRow {
  result: 'good' | 'evil';
}

/** Private: who has which role. */
export interface RoleRow {
  player_id: string;
  role: string;
  special_role: string | null;
}

/** One game's rows. Every method reads the game the source was made for. */
export interface RecordSource {
  game(): Promise<GameRow>;
  players(ids: string[]): Promise<PlayerRow[]>;
  proposals(): Promise<ProposalRow[]>;
  votes(proposalIds: string[]): Promise<VoteRow[]>;
  ladyUses(): Promise<LadyUseRow[]>;
  /** God mode only. */
  roles(roomId: string): Promise<RoleRow[]>;
  /** God mode only. */
  ladyResults(): Promise<LadyResultRow[]>;
}

export function dbRecordSource(db: SupabaseClient, gameId: string): RecordSource {
  return {
    async game() {
      const { data, error } = await db
        .from('games')
        .select(
          'id, room_id, seating_order, current_leader_id, quest_results, assassin_guess_id, winner, win_reason, ended_at'
        )
        .eq('id', gameId)
        .single();
      if (error) throw error;
      return data as GameRow;
    },
    async players(ids) {
      const { data, error } = await db.from('players').select('id, display_name').in('id', ids);
      if (error) throw error;
      return (data ?? []) as PlayerRow[];
    },
    async proposals() {
      const { data, error } = await db
        .from('team_proposals')
        .select(
          'id, quest_number, proposal_number, leader_id, team_member_ids, status, created_at, resolved_at'
        )
        .eq('game_id', gameId);
      if (error) throw error;
      return (data ?? []) as ProposalRow[];
    },
    async votes(proposalIds) {
      if (proposalIds.length === 0) return [];
      const { data, error } = await db
        .from('votes')
        .select('proposal_id, player_id, vote')
        .in('proposal_id', proposalIds);
      if (error) throw error;
      return (data ?? []) as VoteRow[];
    },
    async ladyUses() {
      // Never `result`: it is private to the investigator.
      const { data, error } = await db
        .from('lady_investigations')
        .select('quest_number, investigator_id, target_id')
        .eq('game_id', gameId);
      if (error) throw error;
      return (data ?? []) as LadyUseRow[];
    },
    async roles(roomId) {
      const { data, error } = await db
        .from('player_roles')
        .select('player_id, role, special_role')
        .eq('room_id', roomId);
      if (error) throw error;
      return (data ?? []) as RoleRow[];
    },
    async ladyResults() {
      const { data, error } = await db
        .from('lady_investigations')
        .select('quest_number, investigator_id, target_id, result')
        .eq('game_id', gameId);
      if (error) throw error;
      return (data ?? []) as LadyResultRow[];
    },
  };
}

/**
 * One element of an export file, a JSON array of games. Each holds the game's
 * rows: `game` (the `games` row), `players` ({id, display_name}), `roles`
 * ({player_id, role, special_role}), `proposals` (`team_proposals` rows),
 * `votes` ({proposal_id, player_id, vote}) and `lady` (`lady_investigations`
 * rows). A list with no rows is null. Other keys (room, events, review) are
 * not read.
 */
export interface ExportedGame {
  game: GameRow;
  players: PlayerRow[] | null;
  roles: RoleRow[] | null;
  proposals: ProposalRow[] | null;
  votes: VoteRow[] | null;
  lady: LadyResultRow[] | null;
}

/** Read one game out of an export file. */
export async function readExportedGame(filePath: string, gameId: string): Promise<ExportedGame> {
  const games = JSON.parse(await fs.readFile(filePath, 'utf8')) as ExportedGame[];
  const found = games.find((g) => g.game.id === gameId);
  if (!found) throw new Error(`Game ${gameId} is not in ${filePath}`);
  return found;
}

/** A source over an exported game. Like the database source, its public
 *  methods hand out no role and no Lady result. */
export function exportRecordSource(exported: ExportedGame): RecordSource {
  return {
    // The exported games row holds private columns too (the Split Intel groups,
    // the Merlin decoy); hand out only the fields the database source selects.
    game: async () => {
      const g = exported.game;
      return {
        id: g.id,
        room_id: g.room_id,
        seating_order: g.seating_order,
        current_leader_id: g.current_leader_id,
        quest_results: g.quest_results,
        assassin_guess_id: g.assassin_guess_id,
        winner: g.winner,
        win_reason: g.win_reason,
        ended_at: g.ended_at,
      };
    },
    players: async (ids) => (exported.players ?? []).filter((p) => ids.includes(p.id)),
    proposals: async () => exported.proposals ?? [],
    votes: async (proposalIds) =>
      (exported.votes ?? []).filter((v) => proposalIds.includes(v.proposal_id)),
    ladyUses: async () =>
      (exported.lady ?? []).map((l) => ({
        quest_number: l.quest_number,
        investigator_id: l.investigator_id,
        target_id: l.target_id,
      })),
    roles: async () => exported.roles ?? [],
    ladyResults: async () => exported.lady ?? [],
  };
}
