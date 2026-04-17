/**
 * API Route: POST /api/games/[gameId]/propose
 * Propose a team for the current quest (leader only)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById, updateGamePhase, clearDraftTeam } from '@/lib/supabase/games';
import { createProposal, countProposalsForQuest } from '@/lib/supabase/proposals';
import { logTeamProposed } from '@/lib/supabase/game-events';
import { getQuestRequirement } from '@/lib/domain/quest-config';
import { validateTeamProposal, validateProposer } from '@/lib/domain/team-validation';
import { canProposeTeam } from '@/lib/domain/game-state-machine';
import { errors, handleError } from '@/lib/utils/errors';
import { broadcastPhaseTransition } from '@/lib/broadcast';
import type { ProposeTeamRequest, ProposeTeamResponse } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/games/[gameId]/propose
 * Propose a team for the current quest
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Parse request body
    const body = await request.json() as ProposeTeamRequest;
    const { team_member_ids } = body;

    if (!team_member_ids || !Array.isArray(team_member_ids)) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'team_member_ids is required' } },
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
    if (!canProposeTeam(game.phase)) {
      return NextResponse.json(
        { error: { code: 'INVALID_PHASE', message: 'Cannot propose team in current phase' } },
        { status: 400 }
      );
    }

    // Validate proposer is current leader
    const proposerValidation = validateProposer(user.id, game.current_leader_id);
    if (!proposerValidation.valid) {
      return NextResponse.json(
        { error: { code: 'NOT_LEADER', message: proposerValidation.error } },
        { status: 403 }
      );
    }

    // Get quest requirement
    const questReq = getQuestRequirement(game.player_count, game.current_quest);

    // Validate team proposal
    const teamValidation = validateTeamProposal(
      team_member_ids,
      questReq.size,
      game.seating_order
    );
    if (!teamValidation.valid) {
      return NextResponse.json(
        { error: { code: 'INVALID_TEAM', message: teamValidation.error } },
        { status: 400 }
      );
    }

    // Get proposal number (1-based, resets per quest)
    const proposalCount = await countProposalsForQuest(supabase, gameId, game.current_quest);
    const proposalNumber = proposalCount + 1;

    // Create proposal
    const proposal = await createProposal(supabase, {
      game_id: gameId,
      quest_number: game.current_quest,
      proposal_number: proposalNumber,
      leader_id: user.id,
      team_member_ids,
    });

    // Feature 007: Clear draft team when proposal is submitted
    await clearDraftTeam(supabase, gameId);

    // Update game phase to voting
    await updateGamePhase(supabase, gameId, 'voting');

    // Feature 016: Broadcast phase transition (FR-013)
    await broadcastPhaseTransition(
      gameId,
      'voting',
      'team_building',
      'proposal_submitted',
      game.current_quest
    );

    // Log event
    await logTeamProposed(supabase, gameId, {
      quest_number: game.current_quest,
      proposal_number: proposalNumber,
      leader_id: user.id,
      team_member_ids,
    });

    const response: ProposeTeamResponse = {
      proposal_id: proposal.id,
      quest_number: proposal.quest_number,
      proposal_number: proposal.proposal_number,
      team_member_ids: proposal.team_member_ids,
      leader_id: proposal.leader_id,
    };

    return NextResponse.json({ data: response }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
