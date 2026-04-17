/**
 * API Route: POST /api/games/[gameId]/continue
 * Advance from quest_result to lady_of_lake or team_building for next quest
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getInvestigatedPlayerIds, getPreviousLadyHolderIds } from '@/lib/supabase/lady-investigations';
import { isShowingResults, isTerminalPhase } from '@/lib/domain/game-state-machine';
import { shouldTriggerLadyPhase } from '@/lib/domain/lady-of-lake';
import { errors, handleError } from '@/lib/utils/errors';
import { broadcastPhaseTransition } from '@/lib/broadcast';
import type { ContinueGameResponse } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/games/[gameId]/continue
 * Move to next quest after viewing results
 */
export async function POST(request: Request, { params }: RouteParams) {
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

    // Check if game is already over
    if (isTerminalPhase(game.phase)) {
      const response: ContinueGameResponse = {
        phase: game.phase,
        current_quest: game.current_quest,
        current_leader_id: game.current_leader_id,
        winner: game.winner || undefined,
        win_reason: game.win_reason || undefined,
      };
      return NextResponse.json({ data: response });
    }

    // Check if in quest_result phase
    if (!isShowingResults(game.phase)) {
      return NextResponse.json(
        { error: { code: 'INVALID_PHASE', message: 'Can only continue from quest_result phase' } },
        { status: 400 }
      );
    }

    // Check if Lady phase should trigger (after Quest 2, 3, 4)
    let shouldGoToLadyPhase = false;
    if (game.lady_enabled === true) {
      try {
        const [investigatedIds, previousHolderIds] = await Promise.all([
          getInvestigatedPlayerIds(supabase, gameId),
          getPreviousLadyHolderIds(supabase, gameId),
        ]);
        shouldGoToLadyPhase = shouldTriggerLadyPhase(
          game.current_quest,
          game.lady_enabled,
          investigatedIds,
          previousHolderIds,
          game.seating_order,
          game.lady_holder_id
        );
      } catch {
        shouldGoToLadyPhase = false;
      }
    }

    if (shouldGoToLadyPhase) {
      const { data: updateResult, error: updateError } = await supabase
        .from('games')
        .update({ phase: 'lady_of_lake' })
        .eq('id', gameId)
        .eq('phase', 'quest_result')
        .select()
        .single();

      if (updateError || !updateResult) {
        const currentGame = await getGameById(supabase, gameId);
        const response: ContinueGameResponse = {
          phase: currentGame?.phase || 'team_building',
          current_quest: currentGame?.current_quest || game.current_quest,
          current_leader_id: currentGame?.current_leader_id || game.current_leader_id,
        };
        return NextResponse.json({ data: response });
      }

      await broadcastPhaseTransition(
        gameId,
        'lady_of_lake',
        'quest_result',
        'quest_result_shown',
        game.current_quest
      );

      const response: ContinueGameResponse = {
        phase: 'lady_of_lake',
        current_quest: game.current_quest,
        current_leader_id: game.current_leader_id,
      };

      return NextResponse.json({ data: response });
    }

    const nextLeaderIndex = (game.leader_index + 1) % game.seating_order.length;
    const nextLeaderId = game.seating_order[nextLeaderIndex];
    const nextQuest = game.current_quest + 1;

    const { data: updateResult, error: updateError } = await supabase
      .from('games')
      .update({
        phase: 'team_building',
        current_quest: nextQuest,
        leader_index: nextLeaderIndex,
        current_leader_id: nextLeaderId,
      })
      .eq('id', gameId)
      .eq('phase', 'quest_result')
      .select()
      .single();

    if (updateError || !updateResult) {
      const currentGame = await getGameById(supabase, gameId);
      const response: ContinueGameResponse = {
        phase: currentGame?.phase || 'team_building',
        current_quest: currentGame?.current_quest || game.current_quest + 1,
        current_leader_id: currentGame?.current_leader_id || nextLeaderId,
      };
      return NextResponse.json({ data: response });
    }

    await broadcastPhaseTransition(
      gameId,
      'team_building',
      'quest_result',
      'quest_result_shown',
      nextQuest
    );

    const response: ContinueGameResponse = {
      phase: 'team_building',
      current_quest: nextQuest,
      current_leader_id: nextLeaderId,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    return handleError(error);
  }
}
