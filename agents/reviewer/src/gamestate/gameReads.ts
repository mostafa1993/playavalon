/**
 * What the pipeline's steps read about a game besides its folder: a quest's
 * proposals, votes and mission (quest synthesis), and the outcome (the final
 * report). The live service reads the database; the replay reads an export of
 * the game's rows (recordSource.ts). Both go through the same builders in db.ts.
 *
 * Also here, for the replay: the export's version of the two reads the live
 * service makes before the steps run — the meta snapshot taken at the game's
 * start, and the proposal standing when a turn ended.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameMetaSnapshot } from '../types.js';
import {
  blindRoster,
  buildMetaSnapshot,
  buildQuestStructuredData,
  loadGameOutcome,
  loadQuestStructuredData,
  settledProposals,
  type GameOutcome,
  type LatestProposal,
  type MetaRosterEntry,
  type QuestStructuredData,
} from './db.js';
import type { ExportedGame } from './recordSource.js';

export interface GameReads {
  /** A quest's settled proposals with their votes, and its mission. */
  questData(questNumber: number, playerNames: Map<string, string>): Promise<QuestStructuredData>;
  outcome(): Promise<GameOutcome>;
}

export function dbGameReads(db: SupabaseClient, gameId: string): GameReads {
  return {
    questData: (questNumber, playerNames) =>
      loadQuestStructuredData(db, gameId, questNumber, playerNames),
    outcome: () => loadGameOutcome(db, gameId),
  };
}

export function exportGameReads(exported: ExportedGame): GameReads {
  return {
    questData: async (questNumber, playerNames) => {
      const rows = settledProposals(
        (exported.proposals ?? [])
          .filter((p) => p.quest_number === questNumber)
          .sort((a, b) => a.proposal_number - b.proposal_number)
      );
      const votes = new Map(
        rows.map((p) => [p.id, (exported.votes ?? []).filter((v) => v.proposal_id === p.id)])
      );
      return buildQuestStructuredData(
        questNumber,
        rows,
        votes,
        exported.game.quest_results,
        playerNames
      );
    },
    outcome: async () => ({
      winner: exported.game.winner,
      win_reason: exported.game.win_reason,
      ended_at: exported.game.ended_at,
    }),
  };
}

/**
 * The meta snapshot as the live service took it at the game's start
 * (`loadMetaSnapshot`), from an export. In blind mode the roster is the
 * export's `players` rows only; its `roles` are never read.
 */
export function exportMetaSnapshot(
  exported: ExportedGame,
  mode: 'blind' | 'god'
): GameMetaSnapshot {
  const g = exported.game;
  // The exported games row is the game's end, when the lead has moved on. At
  // the start the leader was the one who led the first proposal — the seat
  // the record numbers 1 too.
  const firstProposal = [...(exported.proposals ?? [])].sort(
    (a, b) => a.quest_number - b.quest_number || a.proposal_number - b.proposal_number
  )[0];
  const firstLeaderId = firstProposal?.leader_id ?? g.current_leader_id;
  const nameById = new Map((exported.players ?? []).map((p) => [p.id, p.display_name]));

  const roster: MetaRosterEntry[] =
    mode === 'blind'
      ? blindRoster(g.seating_order, exported.players ?? [])
      : (exported.roles ?? []).map((r) => ({
          id: r.player_id,
          display_name: nameById.get(r.player_id) ?? 'Unknown',
          role: r.role === 'evil' ? 'evil' : 'good',
          special_role: r.special_role,
        }));

  return buildMetaSnapshot(
    {
      id: g.id,
      room_id: g.room_id,
      player_count: g.player_count,
      seating_order: g.seating_order,
      leader_index: g.seating_order.indexOf(firstLeaderId),
      current_leader_id: firstLeaderId,
      created_at: g.created_at,
    },
    exported.room,
    roster
  );
}

/**
 * The proposal a turn's summary was grounded on live: `getLatestProposal`,
 * read as the turn ended — the latest of its quest made by then (`at`).
 */
export function exportProposalAt(
  exported: ExportedGame,
  questNumber: number,
  at: Date
): LatestProposal | null {
  const latest = (exported.proposals ?? [])
    .filter((p) => p.quest_number === questNumber && Date.parse(p.created_at) <= at.getTime())
    .sort((a, b) => b.proposal_number - a.proposal_number)[0];
  return latest ? { leaderId: latest.leader_id, teamMemberIds: latest.team_member_ids ?? [] } : null;
}
