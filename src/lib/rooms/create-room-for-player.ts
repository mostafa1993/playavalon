/**
 * Room creation, in one place for both ways a room is made: a new room
 * (POST /api/rooms) and the next room after a finished game
 * (POST /api/games/[gameId]/play-again).
 *
 * The player who creates a room is its manager and its first member.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlayerCurrentRoom, cleanupPlayerStartedRooms } from '@/lib/supabase/players';
import { createRoom, addPlayerToRoom, updateRoomStatus } from '@/lib/supabase/rooms';
import { validatePlayerCount } from '@/lib/domain/validation';
import { validateRoleConfig } from '@/lib/domain/role-config';
import { generateSecureRoomCode } from '@/lib/utils/room-code';
import { ERROR_CODES } from '@/lib/utils/constants';
import { ApiError } from '@/lib/utils/errors';
import type { Room } from '@/types/database';
import type { RoleConfig } from '@/types/role-config';

/**
 * Everything a room is set up with
 */
export interface RoomSettings {
  expected_players: number;
  /** The public options only (see pickRoleConfig) */
  role_config: RoleConfig;
  intro_phase_enabled: boolean;
  /** Bot seats the bot supervisor fills; at least one seat stays human */
  agent_count: number;
  ai_review_enabled: boolean;
  ai_review_mode: 'blind' | 'god';
}

const MAX_CODE_ATTEMPTS = 10;

/**
 * Check a room's settings. Returns the error to send, or null when they're valid.
 */
export function validateRoomSettings(settings: RoomSettings): ApiError | null {
  if (!validatePlayerCount(settings.expected_players).valid) {
    return new ApiError(ERROR_CODES.INVALID_PLAYER_COUNT, 'Player count must be 5-10', 400);
  }

  const configValidation = validateRoleConfig(settings.role_config, settings.expected_players);
  if (!configValidation.valid) {
    return new ApiError(ERROR_CODES.INVALID_ROLE_CONFIG, configValidation.errors.join('; '), 400);
  }

  const agentCount = settings.agent_count;
  if (!Number.isInteger(agentCount) || agentCount < 0) {
    return new ApiError(ERROR_CODES.INVALID_AGENT_COUNT, 'agent_count must be a whole number of 0 or more', 400);
  }
  if (agentCount >= settings.expected_players) {
    return new ApiError(
      ERROR_CODES.INVALID_AGENT_COUNT,
      `agent_count (${agentCount}) must be less than expected_players (${settings.expected_players}) — at least one human seat required`,
      400
    );
  }

  return null;
}

/**
 * A room code no room has yet
 */
async function generateUniqueRoomCode(client: SupabaseClient): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateSecureRoomCode();
    const { count, error } = await client
      .from('rooms')
      .select('*', { count: 'exact', head: true })
      .eq('code', code);

    if (error) {
      throw error;
    }
    if (count === 0) return code;
  }

  throw new ApiError(ERROR_CODES.INTERNAL_ERROR, 'Failed to generate unique room code', 500);
}

/**
 * Create a waiting room with the player as its manager and first member.
 *
 * Throws an ApiError when the settings are invalid (400) or the player is
 * already in a waiting or dealt room (409).
 */
export async function createRoomForPlayer(
  client: SupabaseClient,
  playerId: string,
  settings: RoomSettings
): Promise<Room> {
  const invalid = validateRoomSettings(settings);
  if (invalid) {
    throw invalid;
  }

  // Memberships of started and closed rooms are over; clear them first
  await cleanupPlayerStartedRooms(client, playerId);

  // A player is in one waiting or dealt room at a time
  const currentRoom = await getPlayerCurrentRoom(client, playerId);
  if (currentRoom) {
    throw new ApiError(
      ERROR_CODES.PLAYER_ALREADY_IN_ROOM,
      `You are already in room ${currentRoom.room_code}; leave it first`,
      409
    );
  }

  const code = await generateUniqueRoomCode(client);

  const room = await createRoom(client, {
    code,
    manager_id: playerId,
    expected_players: settings.expected_players,
    status: 'waiting',
    role_config: settings.role_config,
    lady_of_lake_enabled: settings.role_config.ladyOfLake || false,
    // Feature 023: opt-in intro round at game start
    intro_phase_enabled: settings.intro_phase_enabled,
    // Feature 024: bot count to auto-fill via the agent supervisor
    agent_count: settings.agent_count,
    // Feature 022: AI Game Reviewer
    ai_review_enabled: settings.ai_review_enabled,
    ai_review_mode: settings.ai_review_mode,
  });

  try {
    await addPlayerToRoom(client, room.id, playerId);
  } catch (error) {
    // A waiting room without its manager would still get bots; close it
    await updateRoomStatus(client, room.id, 'closed');
    throw error;
  }

  return room;
}
