/**
 * API Route: GET /api/games/[gameId]/merlin-quiz/results
 * Feature 010: Endgame Merlin Quiz
 *
 * Returns quiz results after quiz is complete
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getQuizVotes } from '@/lib/supabase/merlin-quiz';
import { calculateQuizResults } from '@/lib/domain/merlin-quiz';
import { errors, handleError } from '@/lib/utils/errors';
import type { GamePlayer } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * GET /api/games/[gameId]/merlin-quiz/results
 * Get quiz results (only returns full results after quiz is complete)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    const supabase = createServiceClient();

    // Get game
    const game = await getGameById(supabase, gameId);
    if (!game) {
      return NextResponse.json(
        { error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } },
        { status: 404 }
      );
    }

    // Verify player is in this game
    if (!game.seating_order.includes(user.id)) {
      return NextResponse.json(
        { error: { code: 'NOT_IN_GAME', message: 'You are not in this game' } },
        { status: 403 }
      );
    }

    // Check if Merlin exists in this game
    const { data: merlinRole } = await supabase
      .from('player_roles')
      .select('player_id')
      .eq('room_id', game.room_id)
      .eq('special_role', 'merlin')
      .single();

    if (!merlinRole) {
      return NextResponse.json(
        { error: { code: 'NO_QUIZ', message: 'No quiz available for this game' } },
        { status: 404 }
      );
    }

    // Get votes
    const votes = await getQuizVotes(supabase, gameId);

    // Get player data for display names
    const { data: playersData } = await supabase
      .from('players')
      .select('id, display_name')
      .in('id', game.seating_order);

    // Build GamePlayer list for results calculation
    const gamePlayers: GamePlayer[] = game.seating_order.map((pid, index) => ({
      id: pid,
      display_name: playersData?.find(p => p.id === pid)?.display_name || 'Unknown',
      seat_position: index,
      is_leader: false,
      is_on_team: false,
      has_voted: false,
      is_connected: true,
    }));

    const results = calculateQuizResults(votes, gamePlayers, merlinRole.player_id);

    return NextResponse.json({
      data: results,
    });
  } catch (error) {
    return handleError(error);
  }
}
