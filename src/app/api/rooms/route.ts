/**
 * API Routes for Rooms
 * POST /api/rooms - Create a new room
 * GET /api/rooms - List waiting rooms
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getPlayerCurrentRoom, cleanupPlayerStartedRooms } from '@/lib/supabase/players';
import { createRoom, addPlayerToRoom, getWaitingRooms } from '@/lib/supabase/rooms';
import { validatePlayerCount } from '@/lib/domain/validation';
import { validateRoleConfig, computeRolesInPlay, getDefaultConfig } from '@/lib/domain/role-config';
import { generateSecureRoomCode } from '@/lib/utils/room-code';
import { errors, handleError } from '@/lib/utils/errors';
import type { CreateRoomPayload, CreateRoomResponse } from '@/types/room';
import type { RoleConfig } from '@/types/role-config';

/**
 * POST /api/rooms - Create a new room
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Parse body
    const body = await request.json() as CreateRoomPayload;

    // Validate player count
    const countValidation = validatePlayerCount(body.expected_players);
    if (!countValidation.valid) {
      return errors.invalidPlayerCount();
    }

    // Validate role configuration if provided
    const roleConfig: RoleConfig = body.role_config || getDefaultConfig();
    const configValidation = validateRoleConfig(roleConfig, body.expected_players);
    if (!configValidation.valid) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_ROLE_CONFIG',
            message: configValidation.errors.join('; ')
          }
        },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Cleanup any stale room memberships (from 'started' games)
    await cleanupPlayerStartedRooms(supabase, user.id);

    // Check if player is already in an active room (waiting or roles_distributed)
    const currentRoom = await getPlayerCurrentRoom(supabase, user.id);
    if (currentRoom) {
      return errors.playerAlreadyInRoom();
    }

    // Generate unique room code
    let code = generateSecureRoomCode();
    let attempts = 0;
    const maxAttempts = 10;

    // Ensure code is unique (retry if collision)
    while (attempts < maxAttempts) {
      const { count } = await supabase
        .from('rooms')
        .select('*', { count: 'exact', head: true })
        .eq('code', code);

      if (count === 0) break;
      code = generateSecureRoomCode();
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return errors.internalError('Failed to generate unique room code');
    }

    // Create room with role_config
    const room = await createRoom(supabase, {
      code,
      manager_id: user.id,
      expected_players: body.expected_players,
      status: 'waiting',
      role_config: roleConfig,
      lady_of_lake_enabled: roleConfig.ladyOfLake || false,
    });

    // Add creator to room
    await addPlayerToRoom(supabase, room.id, user.id);

    // Compute roles in play for response
    const rolesInPlay = computeRolesInPlay(roleConfig);

    const response: CreateRoomResponse = {
      id: room.id,
      code: room.code,
      manager_id: room.manager_id,
      expected_players: room.expected_players,
      status: room.status,
      created_at: room.created_at,
      role_config: room.role_config,
      lady_of_lake_enabled: room.lady_of_lake_enabled,
      roles_in_play: rolesInPlay,
    };

    return NextResponse.json({ data: response }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * GET /api/rooms - List all waiting rooms
 */
export async function GET() {
  try {
    const supabase = createServiceClient();
    const rooms = await getWaitingRooms(supabase);

    return NextResponse.json({ data: rooms });
  } catch (error) {
    return handleError(error);
  }
}
