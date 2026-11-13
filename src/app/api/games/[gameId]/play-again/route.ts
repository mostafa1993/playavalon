/**
 * API Route: POST /api/games/[gameId]/play-again
 * Open the next room for a finished game's players, with the same settings.
 *
 * Any player of the game may ask. Two players asking at once must end with one
 * room, so the caller first claims the next room on the game row (a
 * conditional update, see claimNextRoom), then creates the room and links it.
 * Everyone else is told it's being created and asks again. Any failure after
 * the claim releases it, and closes the room if one was made, so no half-made
 * room is left for the bot supervisor to fill.
 *
 * Responds with { status, room_code }:
 *   - 'created' (201): the caller made the room and is its manager and first member
 *   - 'linked' (200): the next room already exists
 *   - 'being_created' (202, room_code null): another player is creating it
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import {
  getGameById,
  isNextRoomClaimFresh,
  claimNextRoom,
  linkNextRoom,
  releaseNextRoomClaim,
} from '@/lib/supabase/games';
import { findRoomById, updateRoomStatus } from '@/lib/supabase/rooms';
import { getPlayerCurrentRoom } from '@/lib/supabase/players';
import { createRoomForPlayer, type RoomSettings } from '@/lib/rooms/create-room-for-player';
import { playedInGame } from '@/lib/domain/game-membership';
import { errors, handleError } from '@/lib/utils/errors';
import { isValidRoleConfig, pickRoleConfig } from '@/types/role-config';
import type { Room } from '@/types/database';
import type { PlayAgainResult } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

function respond(status: PlayAgainResult['status'], roomCode: string | null, httpStatus: number) {
  const data: PlayAgainResult = { status, room_code: roomCode };
  return NextResponse.json({ data }, { status: httpStatus });
}

/**
 * The finished room's settings, for the next room. Only the setup's public
 * options carry over: role distribution wrote the last game's hidden
 * assignments into the stored setup.
 */
function nextRoomSettings(finishedRoom: Room): RoomSettings {
  if (!isValidRoleConfig(finishedRoom.role_config)) {
    throw new Error(`Room ${finishedRoom.id} has an invalid role setup`);
  }
  return {
    expected_players: finishedRoom.expected_players,
    role_config: pickRoleConfig(finishedRoom.role_config),
    intro_phase_enabled: finishedRoom.intro_phase_enabled,
    agent_count: finishedRoom.agent_count,
    ai_review_enabled: finishedRoom.ai_review_enabled,
    ai_review_mode: finishedRoom.ai_review_mode,
  };
}

/**
 * POST /api/games/[gameId]/play-again
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    const supabase = createServiceClient();

    const game = await getGameById(supabase, gameId);
    if (!game) {
      return NextResponse.json(
        { error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } },
        { status: 404 }
      );
    }

    if (!playedInGame(game, user.id)) {
      return errors.notInGame();
    }

    if (game.phase !== 'game_over') {
      return errors.gameNotOver();
    }

    if (game.next_room_id) {
      const nextRoom = await findRoomById(supabase, game.next_room_id);
      // Gone between the two reads: the link is cleared, ask again
      if (!nextRoom) return respond('being_created', null, 202);
      return respond('linked', nextRoom.code, 200);
    }

    const now = new Date();
    if (isNextRoomClaimFresh(game.next_room_claimed_at, now)) {
      return respond('being_created', null, 202);
    }

    // Refuse before claiming, so a refused caller never holds the claim
    const currentRoom = await getPlayerCurrentRoom(supabase, user.id);
    if (currentRoom) {
      return errors.playerAlreadyInRoom("You're already in another room");
    }

    if (!(await claimNextRoom(supabase, game.id, user.id, now))) {
      // Another player claimed (or linked) it since the game was read
      return respond('being_created', null, 202);
    }

    let createdRoom: Room | null = null;
    try {
      const finishedRoom = await findRoomById(supabase, game.room_id);
      if (!finishedRoom) {
        throw new Error(`Room ${game.room_id} of game ${game.id} not found`);
      }

      createdRoom = await createRoomForPlayer(supabase, user.id, nextRoomSettings(finishedRoom));

      if (!(await linkNextRoom(supabase, game.id, createdRoom.id, user.id, now))) {
        throw new Error(`Lost the claim on game ${game.id}'s next room before linking it`);
      }
    } catch (error) {
      if (createdRoom) {
        await updateRoomStatus(supabase, createdRoom.id, 'closed');
      }
      await releaseNextRoomClaim(supabase, game.id, user.id, now);
      throw error;
    }

    return respond('created', createdRoom.code, 201);
  } catch (error) {
    return handleError(error);
  }
}
