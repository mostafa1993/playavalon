/**
 * Read-only Supabase access for the agent.
 * Uses the service-role key so it can bypass RLS for reading everything
 * it needs (rooms, games, players, roles) — never writes game-state tables.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameMetaSnapshot } from '../types.js';

export function createDbClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** One row shape from the watcher query. */
export interface ActiveGameRow {
  id: string;
  room_id: string;
  room_code: string;
  ai_review_enabled: boolean;
}

/**
 * Return the currently-active game with AI review enabled, or null.
 * The platform guarantees single concurrent game so .limit(1) is safe.
 */
export async function findActiveReviewGame(
  db: SupabaseClient
): Promise<ActiveGameRow | null> {
  const { data, error } = await db
    .from('games')
    .select('id, room_id, rooms!inner(code, ai_review_enabled)')
    .eq('rooms.ai_review_enabled', true)
    .is('ended_at', null)
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0] as unknown as {
    id: string;
    room_id: string;
    rooms: { code: string; ai_review_enabled: boolean } | Array<{ code: string; ai_review_enabled: boolean }>;
  };
  const roomField = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
  if (!roomField) return null;

  return {
    id: row.id,
    room_id: row.room_id,
    room_code: roomField.code,
    ai_review_enabled: roomField.ai_review_enabled,
  };
}

/** Check if a specific game has ended (or been deleted). */
export async function hasGameEnded(db: SupabaseClient, gameId: string): Promise<boolean> {
  const { data, error } = await db
    .from('games')
    .select('ended_at, phase')
    .eq('id', gameId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return true; // row deleted (e.g., room cascade) → treat as ended
  return data.ended_at !== null || data.phase === 'game_over';
}

/**
 * Build the initial meta snapshot for a game: players, roles, seating.
 */
export async function loadMetaSnapshot(
  db: SupabaseClient,
  gameId: string
): Promise<GameMetaSnapshot> {
  const { data: game, error: gameErr } = await db
    .from('games')
    .select('id, room_id, player_count, seating_order, leader_index, current_leader_id, created_at')
    .eq('id', gameId)
    .single();
  if (gameErr) throw gameErr;
  if (!game) throw new Error(`Game ${gameId} not found`);

  const { data: room, error: roomErr } = await db
    .from('rooms')
    .select('id, code')
    .eq('id', game.room_id)
    .single();
  if (roomErr) throw roomErr;
  if (!room) throw new Error(`Room for game ${gameId} not found`);

  const { data: roleRows, error: roleErr } = await db
    .from('player_roles')
    .select('player_id, role, special_role, players!inner(id, display_name)')
    .eq('room_id', game.room_id);
  if (roleErr) throw roleErr;

  type RoleRow = {
    player_id: string;
    role: string;
    special_role: string | null;
    players: { id: string; display_name: string } | Array<{ id: string; display_name: string }>;
  };

  // Build seat-number map from seating_order + leader_index
  const seatMap = new Map<string, number>();
  if (Array.isArray(game.seating_order)) {
    const order = game.seating_order as string[];
    const leaderIdx = typeof game.leader_index === 'number' ? game.leader_index : 0;
    const count = order.length;
    for (let i = 0; i < count; i += 1) {
      const pid = order[i];
      if (!pid) continue;
      seatMap.set(pid, ((i - leaderIdx + count) % count) + 1);
    }
  }

  const players = (roleRows as RoleRow[] || []).map((r) => {
    const pdata = Array.isArray(r.players) ? r.players[0] : r.players;
    return {
      id: r.player_id,
      display_name: pdata?.display_name ?? 'Unknown',
      role: (r.role === 'evil' ? 'evil' : 'good') as 'good' | 'evil',
      special_role: r.special_role,
      seat_number: seatMap.get(r.player_id) ?? null,
    };
  });

  return {
    gameId: game.id,
    roomId: room.id,
    roomCode: room.code,
    playerCount: game.player_count,
    startedAt: game.created_at,
    seatingOrder: (game.seating_order as string[]) ?? [],
    firstLeaderId: game.current_leader_id,
    players,
  };
}

/** Insert a game_reviews row with status='recording' when the agent starts a session. */
export async function insertGameReviewRecording(
  db: SupabaseClient,
  gameId: string
): Promise<void> {
  const { error } = await db
    .from('game_reviews')
    .upsert(
      { game_id: gameId, status: 'recording', updated_at: new Date().toISOString() },
      { onConflict: 'game_id' }
    );
  if (error) throw error;
}

export type GameReviewStatus = 'recording' | 'generating' | 'ready' | 'failed';

/** Update the game_reviews row's status (and optionally paths / error). */
export async function updateGameReview(
  db: SupabaseClient,
  gameId: string,
  patch: {
    status: GameReviewStatus;
    summary_fa_path?: string | null;
    summary_en_path?: string | null;
    error_message?: string | null;
  }
): Promise<void> {
  const { error } = await db
    .from('game_reviews')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('game_id', gameId);
  if (error) throw error;
}

export interface GameOutcome {
  winner: 'good' | 'evil' | null;
  win_reason: string | null;
  ended_at: string | null;
}

/** Read the final outcome of a game. */
export async function loadGameOutcome(
  db: SupabaseClient,
  gameId: string
): Promise<GameOutcome> {
  const { data, error } = await db
    .from('games')
    .select('winner, win_reason, ended_at')
    .eq('id', gameId)
    .maybeSingle();
  if (error) throw error;
  return {
    winner: (data?.winner as 'good' | 'evil' | null) ?? null,
    win_reason: (data?.win_reason as string | null) ?? null,
    ended_at: (data?.ended_at as string | null) ?? null,
  };
}

/**
 * Quest-level data loaded from Supabase: all proposals for the quest,
 * votes per proposal, mission picks (if any), and the quest outcome.
 * `playerId` values are mapped to display names via the optional `playerNames` map.
 */
export interface QuestStructuredData {
  questNumber: number;
  leaderDisplayName: string;
  proposals: Array<{
    proposalNumber: number;
    team: string[];             // display names
    approvals: string[];
    rejections: string[];
    status: 'approved' | 'rejected';
  }>;
  mission: null | {
    team: string[];
    success_count: number;
    fail_count: number;
    result: 'success' | 'fail';
  };
}

/**
 * Return the most recent proposal for a quest (by proposal_number), or null
 * if no proposal exists yet. Used by the per-turn summarizer to ground each
 * speaker's stance on a concrete proposed team + leader.
 */
export async function getLatestProposal(
  db: SupabaseClient,
  gameId: string,
  questNumber: number
): Promise<{ leaderId: string; teamMemberIds: string[] } | null> {
  const { data, error } = await db
    .from('team_proposals')
    .select('leader_id, team_member_ids, proposal_number')
    .eq('game_id', gameId)
    .eq('quest_number', questNumber)
    .order('proposal_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    leaderId: data.leader_id as string,
    teamMemberIds: (data.team_member_ids as string[]) ?? [],
  };
}

export async function loadQuestStructuredData(
  db: SupabaseClient,
  gameId: string,
  questNumber: number,
  playerNames: Map<string, string>
): Promise<QuestStructuredData> {
  const displayName = (id: string) => playerNames.get(id) ?? id;

  const { data: proposalRows, error: propErr } = await db
    .from('team_proposals')
    .select('id, proposal_number, leader_id, team_member_ids, status, approve_count, reject_count')
    .eq('game_id', gameId)
    .eq('quest_number', questNumber)
    .order('proposal_number', { ascending: true });
  if (propErr) throw propErr;

  type PropRow = {
    id: string;
    proposal_number: number;
    leader_id: string;
    team_member_ids: string[];
    status: 'approved' | 'rejected' | 'pending';
  };

  // Skip proposals that are still 'pending' — they shouldn't exist at
  // quest-synthesis time; if any do, they represent incomplete data and
  // would just confuse the LLM (whose output schema only allows
  // approved/rejected). The type predicate narrows `status` so the later
  // `proposals.push` doesn't fall afoul of the 'pending' literal.
  const rows = ((proposalRows as PropRow[]) || []).filter(
    (p): p is PropRow & { status: 'approved' | 'rejected' } =>
      p.status === 'approved' || p.status === 'rejected'
  );
  const proposals: QuestStructuredData['proposals'] = [];
  let leaderId: string | null = null;

  for (const p of rows) {
    leaderId = p.leader_id;
    const { data: voteRows, error: voteErr } = await db
      .from('votes')
      .select('player_id, vote')
      .eq('proposal_id', p.id);
    if (voteErr) throw voteErr;

    const approvals: string[] = [];
    const rejections: string[] = [];
    for (const v of (voteRows || []) as Array<{ player_id: string; vote: 'approve' | 'reject' }>) {
      (v.vote === 'approve' ? approvals : rejections).push(displayName(v.player_id));
    }

    proposals.push({
      proposalNumber: p.proposal_number,
      team: p.team_member_ids.map(displayName),
      approvals,
      rejections,
      status: p.status,
    });
  }

  // Mission result lives on games.quest_results[] (JSON column).
  const { data: gameRow, error: gameErr } = await db
    .from('games')
    .select('quest_results')
    .eq('id', gameId)
    .maybeSingle();
  if (gameErr) throw gameErr;

  type QR = {
    quest: number;
    result: 'success' | 'fail';
    success_count: number;
    fail_count: number;
    team_member_ids: string[];
  };
  const results = (gameRow?.quest_results as QR[] | null) || [];
  const thisQuest = results.find((r) => r.quest === questNumber) || null;

  const mission = thisQuest
    ? {
        team: thisQuest.team_member_ids.map(displayName),
        success_count: thisQuest.success_count,
        fail_count: thisQuest.fail_count,
        result: thisQuest.result,
      }
    : null;

  return {
    questNumber,
    leaderDisplayName: leaderId ? displayName(leaderId) : 'Unknown',
    proposals,
    mission,
  };
}
