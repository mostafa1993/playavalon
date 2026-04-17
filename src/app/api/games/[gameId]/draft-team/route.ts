/**
 * API Route: PUT /api/games/[gameId]/draft-team
 * Update leader's draft team selection (Feature 007)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById, updateDraftTeam } from '@/lib/supabase/games';
import { getQuestRequirement } from '@/lib/domain/quest-config';
import { validateDraftSelection, normalizeDraftTeam } from '@/lib/domain/team-selection';
import { errors, handleError } from '@/lib/utils/errors';
import { broadcastDraftUpdate } from '@/lib/broadcast';
import type { UpdateDraftTeamRequest, UpdateDraftTeamResponse } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * PUT /api/games/[gameId]/draft-team
 * Update the leader's draft team selection
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Parse request body
    const body = await request.json() as UpdateDraftTeamRequest;
    const { team_member_ids } = body;

    if (!Array.isArray(team_member_ids)) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'team_member_ids must be an array' } },
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

    // Check game phase - can only update draft during team_building
    if (game.phase !== 'team_building') {
      return NextResponse.json(
        { error: { code: 'INVALID_PHASE', message: 'Cannot update draft team in current phase' } },
        { status: 400 }
      );
    }

    // Verify player is current leader
    if (user.id !== game.current_leader_id) {
      return NextResponse.json(
        { error: { code: 'NOT_LEADER', message: 'Only the current leader can update team selection' } },
        { status: 403 }
      );
    }

    // Get quest requirement
    const questReq = getQuestRequirement(game.player_count, game.current_quest);

    // Normalize team (remove duplicates)
    const normalizedTeam = normalizeDraftTeam(team_member_ids);

    // Validate draft selection
    const validation = validateDraftSelection(
      normalizedTeam,
      questReq.size,
      game.seating_order
    );

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: {
            code: validation.error?.includes('not in this game') ? 'INVALID_PLAYER_ID' : 'INVALID_TEAM_SIZE',
            message: validation.error
          }
        },
        { status: 400 }
      );
    }

    // Update draft team in database
    const updatedGame = await updateDraftTeam(supabase, gameId, normalizedTeam);

    // Feature 016: Broadcast draft update to all connected clients (FR-001)
    await broadcastDraftUpdate(gameId, updatedGame.draft_team || []);

    const response: UpdateDraftTeamResponse = {
      draft_team: updatedGame.draft_team || [],
      quest_number: updatedGame.current_quest,
      required_size: questReq.size,
      updated_at: updatedGame.updated_at,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}
