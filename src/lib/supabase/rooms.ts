/**
 * Room database queries
 * Updated for Phase 6: Player Recovery & Reconnection
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Room, RoomInsert, RoomPlayer, RoomStatus } from '@/types/database';
import type { RoomListItem, RoomDetails, RoomPlayerInfo } from '@/types/room';
import { getConnectionStatus } from '@/lib/domain/connection-status';

/**
 * Find a room by code
 */
export async function findRoomByCode(
  client: SupabaseClient,
  code: string
): Promise<Room | null> {
  const { data, error } = await client
    .from('rooms')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data as Room | null;
}

/**
 * Find a room by ID
 */
export async function findRoomById(
  client: SupabaseClient,
  id: string
): Promise<Room | null> {
  const { data, error } = await client
    .from('rooms')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data as Room | null;
}

/**
 * Create a new room
 */
export async function createRoom(
  client: SupabaseClient,
  room: RoomInsert
): Promise<Room> {
  const { data, error } = await client
    .from('rooms')
    .insert(room)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as Room;
}

/**
 * Update room status
 */
export async function updateRoomStatus(
  client: SupabaseClient,
  roomId: string,
  status: Room['status']
): Promise<Room> {
  const { data, error } = await client
    .from('rooms')
    .update({
      status,
      last_activity_at: new Date().toISOString()
    })
    .eq('id', roomId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as Room;
}

/**
 * Update room activity timestamp
 */
export async function updateRoomActivity(
  client: SupabaseClient,
  roomId: string
): Promise<void> {
  const { error } = await client
    .from('rooms')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', roomId);

  if (error) {
    throw error;
  }
}

/**
 * T040: Update Lady of Lake holder for a room
 */
export async function updateLadyOfLakeHolder(
  client: SupabaseClient,
  roomId: string,
  holderId: string | null
): Promise<void> {
  const { error } = await client
    .from('rooms')
    .update({
      lady_of_lake_holder_id: holderId,
      last_activity_at: new Date().toISOString()
    })
    .eq('id', roomId);

  if (error) {
    throw error;
  }
}

/**
 * Get all active rooms (waiting and in_progress) with player counts
 * Filters out stale rooms (inactive for more than 24 hours)
 * Feature 015: Also returns status and current_game_id for watch functionality
 */
export async function getWaitingRooms(
  client: SupabaseClient
): Promise<RoomListItem[]> {
  // Calculate cutoff time (24 hours ago)
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from('rooms')
    .select(`
      id,
      code,
      manager_id,
      expected_players,
      created_at,
      last_activity_at,
      status,
      players:room_players(count)
    `)
    .in('status', ['waiting', 'started'])  // Feature 015: Include started games for watching
    .gte('last_activity_at', cutoffTime)  // Only show rooms active within 24h
    .order('last_activity_at', { ascending: false });  // Most recently active first

  if (error) {
    throw error;
  }

  // Get manager display names
  const managerIds = (data || []).map((r: { manager_id: string }) => r.manager_id);
  const { data: managers } = await client
    .from('players')
    .select('id, display_name')
    .in('id', managerIds);

  const managerMap = new Map(
    (managers || []).map((m: { id: string; display_name: string }) => [m.id, m.display_name])
  );

  // Feature 015: Get active games for started rooms
  const startedRoomIds = (data || [])
    .filter((r: { status: string }) => r.status === 'started')
    .map((r: { id: string }) => r.id);

  let gameMap = new Map<string, string>();
  if (startedRoomIds.length > 0) {
    const { data: games } = await client
      .from('games')
      .select('id, room_id')
      .in('room_id', startedRoomIds)
      .is('ended_at', null);  // Only active games

    gameMap = new Map(
      (games || []).map((g: { id: string; room_id: string }) => [g.room_id, g.id])
    );
  }

  return (data || []).map((room: {
    id: string;
    code: string;
    manager_id: string;
    expected_players: number;
    created_at: string;
    last_activity_at: string;
    status: string;
    players: { count: number }[];
  }) => {
    const currentPlayers = room.players[0]?.count || 0;
    return {
      id: room.id,
      code: room.code,
      manager_display_name: managerMap.get(room.manager_id) || 'Unknown',
      expected_players: room.expected_players,
      current_players: currentPlayers,
      is_full: currentPlayers >= room.expected_players,
      created_at: room.created_at,
      last_activity_at: room.last_activity_at,
      // Feature 015: Include status and game ID for watch functionality
      status: room.status as RoomStatus,
      current_game_id: gameMap.get(room.id) || null,
    };
  });
}

/**
 * Get room details with players
 * T037, T038: Updated for Phase 6 to include player connection status
 */
export async function getRoomDetails(
  client: SupabaseClient,
  roomId: string,
  currentUserId: string
): Promise<RoomDetails | null> {
  // Get room
  const room = await findRoomById(client, roomId);
  if (!room) return null;

  // Get players in room with their info (including last_activity_at for Phase 6)
  const { data: roomPlayers, error: rpError } = await client
    .from('room_players')
    .select(`
      player_id,
      joined_at,
      is_connected,
      players!inner (
        id,
        display_name,
        last_activity_at
      )
    `)
    .eq('room_id', roomId);

  if (rpError) {
    throw rpError;
  }

  // Get role confirmations if roles distributed
  let confirmations: { total: number; confirmed: number } | undefined;
  if (room.status === 'roles_distributed') {
    const { data: roles, error: rolesError } = await client
      .from('player_roles')
      .select('is_confirmed')
      .eq('room_id', roomId);

    if (rolesError) {
      throw rolesError;
    }

    confirmations = {
      total: roles?.length || 0,
      confirmed: roles?.filter((r: { is_confirmed: boolean }) => r.is_confirmed).length || 0,
    };
  }

  // Map players with computed connection status (Phase 6)
  // Note: Supabase !inner join returns single object, not array
  const players: RoomPlayerInfo[] = (roomPlayers || []).map((rp: {
    player_id: string;
    joined_at: string;
    is_connected: boolean;
    players: { id: string; display_name: string; last_activity_at?: string } | { id: string; display_name: string; last_activity_at?: string }[];
  }) => {
    // Handle both single object (correct) and array (defensive) cases
    const playerData = Array.isArray(rp.players) ? rp.players[0] : rp.players;

    // T038: Compute connection status from last_activity_at
    const lastActivityAt = playerData?.last_activity_at;
    let connectionStatus = { is_connected: rp.is_connected, seconds_since_activity: 0 };

    if (lastActivityAt) {
      connectionStatus = getConnectionStatus(lastActivityAt);
    }

    return {
      id: rp.player_id,
      display_name: playerData?.display_name || 'Unknown',
      is_manager: rp.player_id === room.manager_id,
      is_connected: connectionStatus.is_connected,
      joined_at: rp.joined_at,
      last_activity_at: lastActivityAt,
      seconds_since_activity: connectionStatus.seconds_since_activity,
    };
  });

  // Find current player
  const currentPlayer = players.find(p => p.id === currentUserId);

  return {
    room,
    players,
    current_player: currentPlayer ? {
      id: currentPlayer.id,
      display_name: currentPlayer.display_name,
      is_manager: currentPlayer.is_manager,
    } : {
      id: currentUserId,
      display_name: 'Unknown',
      is_manager: false,
    },
    confirmations,
  };
}

/**
 * Add player to room
 */
export async function addPlayerToRoom(
  client: SupabaseClient,
  roomId: string,
  playerId: string
): Promise<RoomPlayer> {
  const { data, error } = await client
    .from('room_players')
    .insert({
      room_id: roomId,
      player_id: playerId,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Update room activity
  await updateRoomActivity(client, roomId);

  return data as RoomPlayer;
}

/**
 * Remove player from room
 */
export async function removePlayerFromRoom(
  client: SupabaseClient,
  roomId: string,
  playerId: string
): Promise<void> {
  const { error } = await client
    .from('room_players')
    .delete()
    .eq('room_id', roomId)
    .eq('player_id', playerId);

  if (error) {
    throw error;
  }

  await updateRoomActivity(client, roomId);
}

/**
 * Get player count in room
 */
export async function getRoomPlayerCount(
  client: SupabaseClient,
  roomId: string
): Promise<number> {
  const { count, error } = await client
    .from('room_players')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

/**
 * Check if player is in room
 */
export async function isPlayerInRoom(
  client: SupabaseClient,
  roomId: string,
  playerId: string
): Promise<boolean> {
  const { count, error } = await client
    .from('room_players')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .eq('player_id', playerId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

/**
 * Update manager when current manager leaves
 */
export async function transferManager(
  client: SupabaseClient,
  roomId: string
): Promise<string | null> {
  // Get the longest-present player (excluding the leaving manager)
  const { data, error } = await client
    .from('room_players')
    .select('player_id')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  // Update room manager
  await client
    .from('rooms')
    .update({ manager_id: data.player_id })
    .eq('id', roomId);

  return data.player_id;
}

/**
 * Delete empty room
 */
export async function deleteRoom(
  client: SupabaseClient,
  roomId: string
): Promise<void> {
  const { error } = await client
    .from('rooms')
    .delete()
    .eq('id', roomId);

  if (error) {
    throw error;
  }
}
