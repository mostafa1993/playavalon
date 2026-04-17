/**
 * Player database queries
 *
 * All functions use the user's auth.uid() as the canonical identity.
 * `players.id` equals `auth.users.id`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Player } from '@/types/database';

/**
 * Find a player by their auth.uid() (= players.id)
 */
export async function findPlayerById(
  client: SupabaseClient,
  id: string
): Promise<Player | null> {
  const { data, error } = await client
    .from('players')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data as Player | null;
}

/**
 * Get players by their IDs (bulk lookup)
 */
export async function getPlayersByIds(
  client: SupabaseClient,
  ids: string[]
): Promise<Player[]> {
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from('players')
    .select('*')
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data ?? []) as Player[];
}

/**
 * Check if a user is currently in any active room (waiting or roles_distributed).
 * Does NOT block if player is only in a 'started' or 'closed' room.
 */
export async function getPlayerCurrentRoom(
  client: SupabaseClient,
  userId: string
): Promise<{ room_id: string; room_code: string; status: string } | null> {
  const { data, error } = await client
    .from('room_players')
    .select(`
      room_id,
      rooms!inner (
        code,
        status
      )
    `)
    .eq('player_id', userId);

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  if (!data || data.length === 0) return null;

  type RoomPlayerData = {
    room_id: string;
    rooms: { code: string; status: string } | { code: string; status: string }[];
  };

  for (const entry of data as unknown as RoomPlayerData[]) {
    const rooms = Array.isArray(entry.rooms) ? entry.rooms[0] : entry.rooms;
    if (rooms && (rooms.status === 'waiting' || rooms.status === 'roles_distributed')) {
      return {
        room_id: entry.room_id,
        room_code: rooms.code,
        status: rooms.status,
      };
    }
  }

  return null;
}

/**
 * Remove user from all 'started' or 'closed' rooms (cleanup stale memberships).
 * Returns the number of entries removed.
 */
export async function cleanupPlayerStartedRooms(
  client: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: roomEntries, error: selectError } = await client
    .from('room_players')
    .select(`
      id,
      room_id,
      rooms!inner (
        status
      )
    `)
    .eq('player_id', userId);

  if (selectError) {
    throw selectError;
  }

  if (!roomEntries || roomEntries.length === 0) return 0;

  type EntryWithRoom = {
    id: string;
    room_id: string;
    rooms: { status: string } | { status: string }[];
  };

  const staleEntryIds = (roomEntries as unknown as EntryWithRoom[])
    .filter((entry) => {
      const rooms = Array.isArray(entry.rooms) ? entry.rooms[0] : entry.rooms;
      return rooms?.status === 'started' || rooms?.status === 'closed';
    })
    .map((entry) => entry.id);

  if (staleEntryIds.length === 0) return 0;

  const { error: deleteError } = await client
    .from('room_players')
    .delete()
    .in('id', staleEntryIds);

  if (deleteError) {
    throw deleteError;
  }

  return staleEntryIds.length;
}

/**
 * Update player's last_activity_at (heartbeat).
 * Returns true if the row was found and updated, false otherwise.
 */
export async function updatePlayerActivity(
  client: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { error } = await client
    .from('players')
    .update({
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    if (error.code === 'PGRST116') {
      return false;
    }
    throw error;
  }

  return true;
}
