/**
 * API Route: GET /api/games/[gameId]/history
 * The game's public history for one of its players — see
 * `src/lib/domain/game-history.ts` for what is in it and what is left out.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getAllProposals } from '@/lib/supabase/proposals';
import { getInvestigations } from '@/lib/supabase/lady-investigations';
import { playedInGame } from '@/lib/domain/game-membership';
import { buildGameHistory } from '@/lib/domain/game-history';
import { errors, handleError } from '@/lib/utils/errors';
import type { VoteChoice } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
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

    const [proposals, investigations] = await Promise.all([
      getAllProposals(supabase, gameId),
      getInvestigations(supabase, gameId),
    ]);

    // Only resolved proposals' votes are read at all: a pending one's are secret.
    const resolvedIds = proposals.filter((p) => p.status !== 'pending').map((p) => p.id);
    let votes: Array<{ proposal_id: string; player_id: string; vote: VoteChoice }> = [];
    if (resolvedIds.length > 0) {
      const { data, error } = await supabase
        .from('votes')
        .select('proposal_id, player_id, vote')
        .in('proposal_id', resolvedIds);
      if (error) throw error;
      votes = (data ?? []) as typeof votes;
    }

    return NextResponse.json({
      data: buildGameHistory({
        proposals,
        votes,
        questResults: game.quest_results ?? [],
        investigations,
        viewerId: user.id,
      }),
    });
  } catch (error) {
    return handleError(error);
  }
}
