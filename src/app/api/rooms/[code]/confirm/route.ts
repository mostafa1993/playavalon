/**
 * API Route: POST /api/rooms/[code]/confirm
 * Confirm that player has seen their role
 * Phase 3: Auto-starts game when all players confirm
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, isPlayerInRoom, updateRoomActivity } from '@/lib/supabase/rooms';
import { getPlayerRole, confirmPlayerRole, getRoomConfirmations } from '@/lib/supabase/roles';
import { validateRoomCode } from '@/lib/domain/validation';
import { tryAutoStartGame } from '@/lib/domain/game-start';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/rooms/[code]/confirm
 * Confirm role
 */
export async function POST(request: Request, { params }: RouteParams) {
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

    // Check if roles have been distributed
    if (room.status === 'waiting') {
      return errors.rolesNotDistributed();
    }

    // Get player's role
    const playerRole = await getPlayerRole(supabase, room.id, user.id);
    if (!playerRole) {
      return errors.rolesNotDistributed();
    }

    // Check if already confirmed
    if (playerRole.is_confirmed) {
      return errors.alreadyConfirmed();
    }

    // Confirm the role
    await confirmPlayerRole(supabase, room.id, user.id);

    // Update room activity
    await updateRoomActivity(supabase, room.id);

    // Get confirmation status
    const confirmations = await getRoomConfirmations(supabase, room.id);
    const allConfirmed = confirmations.total === confirmations.confirmed;

    // Phase 3: Auto-start game when all players confirm
    let gameStarted = false;
    let gameData = null;

    if (allConfirmed) {
      const gameResult = await tryAutoStartGame(
        supabase,
        room.id,
        confirmations.total,
        confirmations.confirmed
      );

      if (gameResult) {
        gameStarted = true;
        gameData = {
          game_id: gameResult.game.id,
          phase: gameResult.game.phase,
          current_quest: gameResult.game.current_quest,
          current_leader_id: gameResult.firstLeaderId,
          seating_order: gameResult.seatingOrder,
        };
      }
    }

    return NextResponse.json({
      data: {
        confirmed: true,
        confirmations,
        all_confirmed: allConfirmed,
        game_started: gameStarted,
        game: gameData,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
