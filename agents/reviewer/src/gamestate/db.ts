/**
 * Read-only Supabase access for the agent.
 * Uses the service-role key so it can bypass RLS for reading everything
 * it needs (rooms, games, players, roles) — never writes game-state tables.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameMetaSnapshot } from '../types.js';
import { readRoleConfig, summarizeRoleConfig } from './roleConfig.js';

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
  ai_review_mode: 'blind' | 'god';
}

/**
 * Return the newest active game with AI review enabled, or null.
 *
 * Newest-first matters: an abandoned "zombie" game keeps `ended_at` unset until
 * the cleanup cron (migration 028) ends it, and must not shadow a newer game.
 * The watcher switches to whatever this returns (see watcher.ts).
 */
export async function findActiveReviewGame(
  db: SupabaseClient
): Promise<ActiveGameRow | null> {
  const { data, error } = await db
    .from('games')
    .select('id, room_id, phase, rooms!inner(code, ai_review_enabled, ai_review_mode)')
    .eq('rooms.ai_review_enabled', true)
    .is('ended_at', null)
    .neq('phase', 'game_over')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return null;

  type RoomField = { code: string; ai_review_enabled: boolean; ai_review_mode: string };
  const row = data[0] as unknown as {
    id: string;
    room_id: string;
    rooms: RoomField | RoomField[];
  };
  const roomField = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
  if (!roomField) return null;

  return {
    id: row.id,
    room_id: row.room_id,
    room_code: roomField.code,
    ai_review_enabled: roomField.ai_review_enabled,
    ai_review_mode: roomField.ai_review_mode === 'god' ? 'god' : 'blind',
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
  gameId: string,
  mode: 'blind' | 'god'
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
    .select('id, code, role_config')
    .eq('id', game.room_id)
    .single();
  if (roomErr) throw roomErr;
  if (!room) throw new Error(`Room for game ${gameId} not found`);

  const order = Array.isArray(game.seating_order) ? (game.seating_order as string[]) : [];

  let roster: MetaRosterEntry[];
  if (mode === 'blind') {
    // BLIND: never touch player_roles. Build the roster (names + seats) from the
    // public players table, keyed off the game's seating_order. role/special_role
    // are intentionally omitted — the reviewer deduces them from public play.
    const { data: rows, error: rosterErr } = await db
      .from('players')
      .select('id, display_name')
      .in('id', order);
    if (rosterErr) throw rosterErr;
    roster = blindRoster(order, (rows ?? []) as Array<{ id: string; display_name: string }>);
  } else {
    // GOD: read the real roles.
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

    roster = (roleRows as RoleRow[] || []).map((r) => {
      const pdata = Array.isArray(r.players) ? r.players[0] : r.players;
      return {
        id: r.player_id,
        display_name: pdata?.display_name ?? 'Unknown',
        role: (r.role === 'evil' ? 'evil' : 'good') as 'good' | 'evil',
        special_role: r.special_role,
      };
    });
  }

  return buildMetaSnapshot(game as MetaGameRow, room as MetaRoomRow, roster);
}

/** The `games` columns the meta snapshot reads, as they stand at the game's start. */
export interface MetaGameRow {
  id: string;
  room_id: string;
  player_count: number;
  seating_order: string[] | null;
  leader_index: number | null;
  current_leader_id: string;
  created_at: string;
}

export interface MetaRoomRow {
  id: string;
  code: string;
  role_config: unknown;
}

/** One roster entry before seating; roles only in god mode. */
export type MetaRosterEntry = Omit<GameMetaSnapshot['players'][number], 'seat_number'>;

/** The blind roster: the seated players' public names, in seating order. */
export function blindRoster(
  order: string[],
  rows: Array<{ id: string; display_name: string }>
): MetaRosterEntry[] {
  const nameById = new Map(rows.map((r) => [r.id, r.display_name]));
  return order.map((pid) => ({ id: pid, display_name: nameById.get(pid) ?? 'Unknown' }));
}

/** The meta snapshot from its rows; the database read and the replay's export read share it. */
export function buildMetaSnapshot(
  game: MetaGameRow,
  room: MetaRoomRow,
  roster: MetaRosterEntry[]
): GameMetaSnapshot {
  // Public game setup (good/evil counts + enabled special roles). Safe for both
  // modes — it's the configuration, not who-has-what. Lets the blind detective
  // constrain its guesses to roles that actually exist in this match.
  const rolesInPlay = summarizeRoleConfig(game.player_count, readRoleConfig(room.role_config));

  // Build seat-number map from seating_order + leader_index (role-free).
  const order = Array.isArray(game.seating_order) ? game.seating_order : [];
  const seatMap = new Map<string, number>();
  {
    const leaderIdx = typeof game.leader_index === 'number' ? game.leader_index : 0;
    const count = order.length;
    for (let i = 0; i < count; i += 1) {
      const pid = order[i];
      if (!pid) continue;
      seatMap.set(pid, ((i - leaderIdx + count) % count) + 1);
    }
  }

  return {
    gameId: game.id,
    roomId: room.id,
    roomCode: room.code,
    playerCount: game.player_count,
    startedAt: game.created_at,
    seatingOrder: game.seating_order ?? [],
    firstLeaderId: game.current_leader_id,
    players: roster.map((p) => ({ ...p, seat_number: seatMap.get(p.id) ?? null })),
    rolesInPlay,
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

/** How the game ended, as its `games` row holds it. */
export interface GameOutcome {
  winner: 'good' | 'evil' | null;
  win_reason: string | null;
  ended_at: string | null;
}
