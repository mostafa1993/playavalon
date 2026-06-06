/**
 * API Route: POST /api/games/[gameId]/end-intro
 *
 * Feature 023: end the one-time intro round and let the leader propose Quest 1.
 *
 * Manager-only. Idempotent — calling it when the game is already past intro
 * is a no-op (returns 200 with the current flag value).
 *
 * Does not change game.phase (which stays 'team_building' the whole time);
 * it only flips games.in_intro_phase from true → false, which unblocks the
 * propose endpoint and reveals the propose form in the leader's UI.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { findRoomById } from '@/lib/supabase/rooms';
import { broadcastPhaseTransition } from '@/lib/broadcast';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) return errors.unauthorized();

    const supabase = createServiceClient();

    const game = await getGameById(supabase, gameId);
    if (!game) {
      return NextResponse.json(
        { error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } },
        { status: 404 }
      );
    }

    // Only the room manager can end the intro round.
    const room = await findRoomById(supabase, game.room_id);
    if (!room) return errors.notFound('Room');
    if (room.manager_id !== user.id) return errors.notRoomManager();

    // Idempotent: if intro is already over, just report success.
    if (!game.in_intro_phase) {
      return NextResponse.json({
        data: { in_intro_phase: false, already_ended: true },
      });
    }

    const { error: updateErr } = await supabase
      .from('games')
      .update({ in_intro_phase: false })
      .eq('id', gameId);
    if (updateErr) throw updateErr;

    // Tell everyone in the game's broadcast channel that something changed,
    // so subscribed clients re-fetch /api/games/[gameId] and see the new flag.
    // The phase itself doesn't change (still team_building); we use the
    // `intro_ended` trigger to communicate the meaning.
    await broadcastPhaseTransition(
      gameId,
      game.phase,
      game.phase,
      'intro_ended',
      game.current_quest,
    );

    return NextResponse.json({
      data: { in_intro_phase: false, already_ended: false },
    });
  } catch (error) {
    return handleError(error);
  }
}
