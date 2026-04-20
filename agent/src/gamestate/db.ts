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
