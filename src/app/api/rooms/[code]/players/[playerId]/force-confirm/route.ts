/**
 * API Route: POST /api/rooms/[code]/players/[playerId]/force-confirm
 *
 * Manager-only escape hatch for the confirmation-stuck bug:
 * when a player claims they've already confirmed but the dashboard
 * still shows them as ⏳ waiting (e.g., the 10-player session where
 * the count was stuck at 9/10), the manager can force-confirm that
 * player's role so the game can start.
 *
 * Auth + validation:
 *   - Caller must be the room manager (NOT just any member).
 *   - Room must be in 'roles_distributed' status.
 *   - Target must have a player_roles row for this room.
 *   - If target is already confirmed → idempotent 200 (no-op).
 *
 * Auto-start behavior matches the regular confirm endpoint: if the
 * forced confirmation closes the last gap, the game auto-starts.
 *
 * Audit note: this overrides whatever the target player actually did.
 * Use sparingly. The UI exposes it only when a player is in_room AND
 * not yet confirmed.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findRoomByCode, isPlayerInRoom, updateRoomActivity } from '@/lib/supabase/rooms';
import { getPlayerRole, confirmPlayerRole, getRoomConfirmations } from '@/lib/supabase/roles';
import { validateRoomCode } from '@/lib/domain/validation';
import { tryAutoStartGame } from '@/lib/domain/game-start';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ code: string; playerId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { code, playerId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Validate room code format.
    const codeValidation = validateRoomCode(code);
    if (!codeValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_CODE', message: codeValidation.error } },
        { status: 400 }
      );
    }
    if (!playerId) {
      return NextResponse.json(
        { error: { code: 'MISSING_PLAYER_ID', message: 'playerId path param required' } },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const room = await findRoomByCode(supabase, code);
    if (!room) {
      return errors.roomNotFound();
    }

    // Manager-only — not just any room member.
    if (room.manager_id !== user.id) {
      return NextResponse.json(
        { error: { code: 'NOT_ROOM_MANAGER', message: 'Only the room manager can force-confirm a player' } },
        { status: 403 }
      );
    }

    if (room.status === 'waiting') {
      return errors.rolesNotDistributed();
    }

    // Target must currently be in the room (otherwise this is the leaver
    // orphan case — force-confirming a ghost player doesn't actually help;
    // the player_roles row needs cleanup or the player needs to rejoin).
    const targetInRoom = await isPlayerInRoom(supabase, room.id, playerId);
    if (!targetInRoom) {
      return NextResponse.json(
        { error: { code: 'TARGET_NOT_IN_ROOM', message: 'That player is no longer in the room. Have them rejoin first.' } },
        { status: 409 }
      );
    }

    const playerRole = await getPlayerRole(supabase, room.id, playerId);
    if (!playerRole) {
      return errors.rolesNotDistributed();
    }

    // Already confirmed → idempotent. Returning 200 lets the UI race-double-click
    // safely (manager hits force-confirm at the same moment the player
    // confirms naturally; we don't want to surface a scary error).
    if (playerRole.is_confirmed) {
      const confirmations = await getRoomConfirmations(supabase, room.id);
      return NextResponse.json({
        data: {
          forced: false,
          already_confirmed: true,
          confirmations,
          all_confirmed: confirmations.total === confirmations.confirmed,
        },
      });
    }

    await confirmPlayerRole(supabase, room.id, playerId);
    await updateRoomActivity(supabase, room.id);

    const confirmations = await getRoomConfirmations(supabase, room.id);
    const allConfirmed = confirmations.total === confirmations.confirmed;

    // Auto-start if this forced confirmation closes the gap (mirrors the
    // self-confirm endpoint's behavior).
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
        forced: true,
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
