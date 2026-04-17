/**
 * API Route: POST /api/rooms/[code]/join
 * Join an existing room by code
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getPlayerCurrentRoom } from '@/lib/supabase/players';
import {
  findRoomByCode,
  addPlayerToRoom,
  getRoomPlayerCount,
  isPlayerInRoom,
} from '@/lib/supabase/rooms';
import { validateRoomCode, canJoinRoom } from '@/lib/domain/validation';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * POST /api/rooms/[code]/join
 * Join a room by its code
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

    // Check if player is already in this room (rejoin)
    const alreadyInRoom = await isPlayerInRoom(supabase, room.id, user.id);
    if (alreadyInRoom) {
      // Update connection status for rejoin
      await supabase
        .from('room_players')
        .update({
          is_connected: true,
          disconnected_at: null,
        })
        .eq('room_id', room.id)
        .eq('player_id', user.id);

      return NextResponse.json({
        data: {
          room_id: room.id,
          user_id: user.id,
          joined_at: new Date().toISOString(),
          is_rejoin: true,
        },
      });
    }

    // Check if player is in another room
    const currentRoom = await getPlayerCurrentRoom(supabase, user.id);
    if (currentRoom) {
      return errors.playerAlreadyInRoom();
    }

    // Get current player count
    const currentPlayerCount = await getRoomPlayerCount(supabase, room.id);

    // Validate room can accept more players
    const joinValidation = canJoinRoom(room.status, currentPlayerCount, room.expected_players);
    if (!joinValidation.valid) {
      if (joinValidation.error?.includes('full')) {
        return errors.roomFull();
      }
      return errors.roomNotWaiting();
    }

    // Add player to room (usernames are globally unique, so no in-room nickname collision check needed)
    const roomPlayer = await addPlayerToRoom(supabase, room.id, user.id);

    return NextResponse.json({
      data: {
        room_id: room.id,
        user_id: user.id,
        joined_at: roomPlayer.joined_at,
        is_rejoin: false,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
