/**
 * API Route: GET /api/rooms/[code]
 * Get room details including players
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, getRoomDetails, isPlayerInRoom } from '@/lib/supabase/rooms';
import { validateRoomCode } from '@/lib/domain/validation';
import { computeRolesInPlay } from '@/lib/domain/role-config';
import { playedInGame } from '@/lib/domain/game-membership';
import { errors, handleError } from '@/lib/utils/errors';
import { isValidRoleConfig, pickRoleConfig } from '@/types/role-config';
import type { RoomDetails } from '@/types/room';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/rooms/[code]
 * Get room details with player list
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Validate room code format
    const codeValidation = validateRoomCode(code);
    if (!codeValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_CODE', message: codeValidation.error } },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Find the room
    const room = await findRoomByCode(supabase, code);
    if (!room) {
      return errors.roomNotFound();
    }

    // Check if player is in this room
    const isMember = await isPlayerInRoom(supabase, room.id, user.id);
    if (!isMember) {
      return errors.notRoomMember();
    }

    // Get room details with players
    const details = await getRoomDetails(supabase, room.id, user.id);
    if (!details) {
      return errors.roomNotFound();
    }

    // Compute roles in play from room configuration
    if (!isValidRoleConfig(room.role_config)) {
      return errors.internalError('Room has an invalid role setup');
    }
    const rolesInPlay = computeRolesInPlay(room.role_config);

    // Get Lady of Lake holder info if applicable
    let ladyOfLakeHolder = null;
    if (room.lady_of_lake_holder_id) {
      const holder = details.players.find(p => p.id === room.lady_of_lake_holder_id);
      if (holder) {
        ladyOfLakeHolder = { id: holder.id, display_name: holder.display_name };
      }
    }

    // Feature 022: AI Game Reviewer state (manager toggle; no per-player consent)
    const aiReview: {
      enabled: boolean;
      mode: 'blind' | 'god';
    } = {
      enabled: room.ai_review_enabled,
      mode: room.ai_review_mode,
    };

    // Play again: the finished game this room was opened from, for the lobby's
    // links back to it. Only for people who played it: anyone else who joins
    // from the public list can't open it.
    let previousGame: RoomDetails['previous_game'] = null;
    const { data: previous, error: previousError } = await supabase
      .from('games')
      .select('id, seating_order')
      .eq('next_room_id', room.id)
      .maybeSingle();
    if (previousError) throw previousError;
    if (previous && playedInGame(previous, user.id)) {
      const { count, error: reviewError } = await supabase
        .from('game_reviews')
        .select('game_id', { count: 'exact', head: true })
        .eq('game_id', previous.id);
      if (reviewError) throw reviewError;
      previousGame = { id: previous.id, reviewed: (count ?? 0) > 0 };
    }

    return NextResponse.json({
      data: {
        ...details,
        // Only the public options: role distribution writes hidden assignments
        // (the decoy, the Split Intel groups, the Evil Ring) into the stored
        // setup, and every member reads this response.
        room: { ...details.room, role_config: pickRoleConfig(room.role_config) },
        roles_in_play: rolesInPlay,
        lady_of_lake_holder: ladyOfLakeHolder,
        ai_review: aiReview,
        previous_game: previousGame,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
