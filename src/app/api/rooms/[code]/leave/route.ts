/**
 * API Route: POST /api/rooms/[code]/leave
 * Leave the current room
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import {
  findRoomByCode,
  removePlayerFromRoom,
  isPlayerInRoom,
  getRoomPlayerCount,
  transferManager,
  deleteRoom,
} from '@/lib/supabase/rooms';
import { validateRoomCode } from '@/lib/domain/validation';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/rooms/[code]/leave
 * Leave the room
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

    // Remove player from room
    await removePlayerFromRoom(supabase, room.id, user.id);

    // Check if player was manager
    const wasManager = room.manager_id === user.id;

    // Get remaining player count
    const remainingPlayers = await getRoomPlayerCount(supabase, room.id);

    if (remainingPlayers === 0) {
      // Delete empty room
      await deleteRoom(supabase, room.id);
    } else if (wasManager) {
      // Transfer manager to longest-present player
      await transferManager(supabase, room.id);
    }

    return NextResponse.json({
      data: {
        left: true,
        room_code: code,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
