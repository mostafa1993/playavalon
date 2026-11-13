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
  getRoomMembers,
  transferManager,
  updateRoomStatus,
} from '@/lib/supabase/rooms';
import { validateRoomCode } from '@/lib/domain/validation';
import { countHumans } from '@/lib/domain/room-members';
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

    // Snapshot the pre-leave status — used to decide whether to roll back the
    // role distribution (see below).
    const statusBeforeLeave = room.status;

    // Remove player from room
    await removePlayerFromRoom(supabase, room.id, user.id);

    // Check if player was manager
    const wasManager = room.manager_id === user.id;

    // Bots never leave through this route, so a room is empty once no human
    // is left in it
    const remainingHumans = countHumans(await getRoomMembers(supabase, room.id));

    if (remainingHumans === 0) {
      // Close the room, never delete it: its games and their history hang off
      // it. Closing makes the bots' processes exit, and frees a finished game's
      // link to this room as its next room (migration 032).
      if (statusBeforeLeave !== 'closed') {
        await updateRoomStatus(supabase, room.id, 'closed');
      }
    } else {
      if (wasManager) {
        // Transfer manager to the longest-present human
        await transferManager(supabase, room.id);
      }

      // Leaver-bug fix: if a player leaves between role distribution and game
      // start, their player_roles row would be left orphaned, stuck-at-N/M
      // forever. Roll the room back to 'waiting' and wipe all role rows so the
      // manager can re-distribute with whoever is still present.
      // (Once the game is 'started', leaving mid-game is a different problem
      // and we don't touch the game state here.)
      if (statusBeforeLeave === 'roles_distributed') {
        const { error: rolesDelErr } = await supabase
          .from('player_roles')
          .delete()
          .eq('room_id', room.id);
        if (rolesDelErr) throw rolesDelErr;
        await updateRoomStatus(supabase, room.id, 'waiting');
      }
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
