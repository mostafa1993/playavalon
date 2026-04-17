/**
 * API Route: POST /api/games/[gameId]/quest/action
 * Submit quest action (success/fail) - team members only
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getActiveProposalForQuest } from '@/lib/supabase/proposals';
import { getPlayerRole } from '@/lib/supabase/roles';
import { submitQuestAction, getActionCount, calculateQuestResult } from '@/lib/supabase/quest-actions';
import { logQuestCompleted } from '@/lib/supabase/game-events';
import { updateRoomStatus } from '@/lib/supabase/rooms';
import { canSubmitQuestAction } from '@/lib/domain/game-state-machine';
import { getQuestRequirement } from '@/lib/domain/quest-config';
import { calculateQuestOutcome, validateQuestAction, isOnQuestTeam } from '@/lib/domain/quest-resolver';
import { checkWinConditions } from '@/lib/domain/win-conditions';
import { errors, handleError } from '@/lib/utils/errors';
import {
  broadcastActionSubmitted,
  broadcastPhaseTransition,
  broadcastGameOver,
} from '@/lib/broadcast';
import type { QuestActionRequest, QuestActionResponse, QuestResult, WinReason } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/games/[gameId]/quest/action
 * Submit quest action
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Parse request body
    const body = await request.json() as QuestActionRequest;
    const { action } = body;

    if (!action || !['success', 'fail'].includes(action)) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'action must be "success" or "fail"' } },
        { status: 400 }
      );
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

    // Check game phase
    if (!canSubmitQuestAction(game.phase)) {
      return NextResponse.json(
        { error: { code: 'INVALID_PHASE', message: 'Cannot submit action in current phase' } },
        { status: 400 }
      );
    }

    // Get approved proposal for current quest (to check team membership)
    const proposal = await getActiveProposalForQuest(supabase, gameId, game.current_quest);
    if (!proposal) {
      return NextResponse.json(
        { error: { code: 'NO_PROPOSAL', message: 'No active quest' } },
        { status: 400 }
      );
    }

    // Verify player is on quest team
    if (!isOnQuestTeam(proposal.team_member_ids, user.id)) {
      return NextResponse.json(
        { error: { code: 'NOT_TEAM_MEMBER', message: 'You are not on this quest team' } },
        { status: 403 }
      );
    }

    // Get player's role to validate action
    const playerRole = await getPlayerRole(supabase, game.room_id, user.id);
    if (!playerRole) {
      return NextResponse.json(
        { error: { code: 'NO_ROLE', message: 'Player role not found' } },
        { status: 500 }
      );
    }

    // Validate action
    const actionValidation = validateQuestAction(
      playerRole.role,
      action,
      playerRole.special_role,
      game.current_quest
    );
    if (!actionValidation.valid) {
      return NextResponse.json(
        { error: { code: actionValidation.errorCode || 'INVALID_ACTION', message: actionValidation.error } },
        { status: 400 }
      );
    }

    // Submit action (will throw if already submitted)
    try {
      await submitQuestAction(supabase, {
        game_id: gameId,
        quest_number: game.current_quest,
        player_id: user.id,
        action,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'ALREADY_SUBMITTED') {
        return NextResponse.json(
          { error: { code: 'ALREADY_SUBMITTED', message: 'You have already submitted an action' } },
          { status: 400 }
        );
      }
      throw err;
    }

    // Get action count
    const actionsSubmitted = await getActionCount(supabase, gameId, game.current_quest);
    const totalTeamMembers = proposal.team_member_ids.length;

    // Feature 016: Broadcast action submission (FR-003)
    await broadcastActionSubmitted(gameId, actionsSubmitted, totalTeamMembers);

    // Check if all actions are in
    if (actionsSubmitted === totalTeamMembers) {
      const actionCounts = await calculateQuestResult(supabase, gameId, game.current_quest);
      const questReq = getQuestRequirement(game.player_count, game.current_quest);

      const outcome = calculateQuestOutcome(
        Array(actionCounts.success).fill('success').concat(Array(actionCounts.fail).fill('fail')),
        questReq.fails
      );

      const questResult: QuestResult = {
        quest: game.current_quest,
        result: outcome.outcome,
        success_count: outcome.successCount,
        fail_count: outcome.failCount,
        team_member_ids: proposal.team_member_ids,
        completed_at: new Date().toISOString(),
      };

      await logQuestCompleted(supabase, gameId, {
        quest_number: game.current_quest,
        result: outcome.outcome,
        success_count: outcome.successCount,
        fail_count: outcome.failCount,
        team_size: totalTeamMembers,
      });

      const updatedResults = [...game.quest_results, questResult];

      const { data: merlinCheck } = await supabase
        .from('player_roles')
        .select('id')
        .eq('room_id', game.room_id)
        .eq('special_role', 'merlin')
        .single();

      const hasMerlin = !!merlinCheck;
      const winCheck = checkWinConditions(updatedResults, 0, hasMerlin);

      if (winCheck.assassinPhase) {
        const { error: updateError } = await supabase
          .from('games')
          .update({
            quest_results: updatedResults,
            phase: 'assassin',
          })
          .eq('id', gameId)
          .eq('phase', 'quest');

        if (updateError) {
          console.log('Quest result already processed by another request');
        } else {
          await broadcastPhaseTransition(
            gameId,
            'assassin',
            'quest',
            'assassin_phase',
            game.current_quest
          );
        }
      } else if (winCheck.gameOver) {
        const { error: updateError } = await supabase
          .from('games')
          .update({
            quest_results: updatedResults,
            phase: 'game_over',
            winner: winCheck.winner,
            win_reason: winCheck.reason,
            ended_at: new Date().toISOString(),
          })
          .eq('id', gameId)
          .eq('phase', 'quest');

        if (updateError) {
          console.log('Quest result already processed by another request');
        } else {
          await updateRoomStatus(supabase, game.room_id, 'closed');

          await broadcastGameOver(
            gameId,
            winCheck.winner!,
            winCheck.reason as WinReason
          );
        }
      } else {
        const { error: updateError } = await supabase
          .from('games')
          .update({
            quest_results: updatedResults,
            phase: 'quest_result',
          })
          .eq('id', gameId)
          .eq('phase', 'quest');

        if (updateError) {
          console.log('Quest result already processed by another request');
        } else {
          await broadcastPhaseTransition(
            gameId,
            'quest_result',
            'quest',
            'quest_complete',
            game.current_quest
          );
        }
      }
    }

    const response: QuestActionResponse = {
      recorded: true,
      actions_submitted: actionsSubmitted,
      total_team_members: totalTeamMembers,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    return handleError(error);
  }
}
