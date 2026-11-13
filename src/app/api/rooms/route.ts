/**
 * API Routes for Rooms
 * POST /api/rooms - Create a new room
 * GET /api/rooms - List waiting rooms
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getWaitingRooms } from '@/lib/supabase/rooms';
import { computeRolesInPlay } from '@/lib/domain/role-config';
import { createRoomForPlayer } from '@/lib/rooms/create-room-for-player';
import { errors, handleError } from '@/lib/utils/errors';
import { isValidRoleConfig, pickRoleConfig } from '@/types/role-config';
import type { CreateRoomPayload, CreateRoomResponse } from '@/types/room';

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

    // Role configuration is required: it states whether Merlin is in the game
    if (!isValidRoleConfig(body.role_config)) {
      return errors.invalidRequest(
        'role_config must be a role setup with merlin set to true or false'
      );
    }

    const supabase = createServiceClient();

    // Validates the settings, and refuses a player already in a waiting or dealt room
    const room = await createRoomForPlayer(supabase, user.id, {
      expected_players: body.expected_players,
      role_config: pickRoleConfig(body.role_config),
      intro_phase_enabled: body.intro_phase_enabled === true,
      // Feature 024: defaults to 0 (no bots) if not provided
      agent_count: Math.max(0, Math.floor(body.agent_count ?? 0)),
      // AI review is turned on afterwards, from the lobby
      ai_review_enabled: false,
      ai_review_mode: 'blind',
    });

    // Compute roles in play for response
    const rolesInPlay = computeRolesInPlay(room.role_config);

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
