/**
 * POST /api/games/[gameId]/lady-investigate
 * Submit Lady of the Lake investigation
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getPlayerRole } from '@/lib/supabase/roles';
import {
  createInvestigation,
  getInvestigatedPlayerIds,
  getPreviousLadyHolderIds,
} from '@/lib/supabase/lady-investigations';
import {
  validateInvestigationTarget,
  getInvestigationResult
} from '@/lib/domain/lady-of-lake';
import { isLadyPhase } from '@/lib/domain/game-state-machine';
import type { LadyInvestigateResponse } from '@/types/game';

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await context.params;
    const body = await request.json();
    const { target_player_id } = body;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    if (!target_player_id) {
      return NextResponse.json(
        { error: 'target_player_id is required' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Get game state
    const game = await getGameById(supabase, gameId);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game is in Lady phase
    if (!isLadyPhase(game.phase)) {
      return NextResponse.json(
        { error: 'Game is not in Lady of the Lake phase', code: 'NOT_LADY_PHASE' },
        { status: 400 }
      );
    }

    // Verify the player exists in the game
    if (!game.seating_order.includes(user.id)) {
      return NextResponse.json(
        { error: 'Player not in this game' },
        { status: 403 }
      );
    }

    // Verify player is the Lady holder
    if (game.lady_holder_id !== user.id) {
      return NextResponse.json(
        { error: 'You are not the Lady of the Lake holder', code: 'NOT_LADY_HOLDER' },
        { status: 403 }
      );
    }

    // Get investigated player IDs and previous Lady holders
    const [investigatedIds, previousHolderIds] = await Promise.all([
      getInvestigatedPlayerIds(supabase, gameId),
      getPreviousLadyHolderIds(supabase, gameId),
    ]);

    // Validate target
    const validationError = validateInvestigationTarget(
      target_player_id,
      user.id,
      investigatedIds,
      previousHolderIds,
      game.seating_order
    );

    if (validationError) {
      const code = validationError.includes('yourself')
        ? 'CANNOT_INVESTIGATE_SELF'
        : validationError.includes('held the Lady')
          ? 'PREVIOUS_LADY_HOLDER'
          : validationError.includes('already')
            ? 'ALREADY_INVESTIGATED'
            : 'INVALID_TARGET';
      return NextResponse.json(
        { error: validationError, code },
        { status: 400 }
      );
    }

    // Get target player's role
    const targetRole = await getPlayerRole(supabase, game.room_id, target_player_id);
    if (!targetRole) {
      return NextResponse.json(
        { error: 'Target player role not found' },
        { status: 500 }
      );
    }

    // Get investigation result (Good or Evil)
    const result = getInvestigationResult(targetRole.role);

    // Create investigation record
    await createInvestigation(supabase, {
      game_id: gameId,
      quest_number: game.current_quest,
      investigator_id: user.id,
      target_id: target_player_id,
      result,
    });

    // Atomic update with optimistic lock
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
        lady_holder_id: target_player_id,
      })
      .eq('id', gameId)
      .eq('phase', 'lady_of_lake')
      .select()
      .single();

    if (updateError || !updateResult) {
      const currentGame = await getGameById(supabase, gameId);

      const { data: targetData } = await supabase
        .from('players')
        .select('display_name')
        .eq('id', target_player_id)
        .single();

      const response: LadyInvestigateResponse = {
        success: true,
        result,
        new_holder_id: target_player_id,
        new_holder_display_name: targetData?.display_name || 'Unknown',
        next_quest: currentGame?.current_quest || nextQuest,
      };

      return NextResponse.json({ data: response });
    }

    // Get target player's display name for response
    const { data: targetData } = await supabase
      .from('players')
      .select('display_name')
      .eq('id', target_player_id)
      .single();

    const response: LadyInvestigateResponse = {
      success: true,
      result,
      new_holder_id: target_player_id,
      new_holder_display_name: targetData?.display_name || 'Unknown',
      next_quest: nextQuest,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('Lady investigation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
