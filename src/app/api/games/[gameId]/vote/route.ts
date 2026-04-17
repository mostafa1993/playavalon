/**
 * API Route: POST /api/games/[gameId]/vote
 * Submit vote on current team proposal
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById, endGame } from '@/lib/supabase/games';
import { getCurrentProposal, resolveProposal } from '@/lib/supabase/proposals';
import { submitVote, getVoteCount, calculateVoteTotals } from '@/lib/supabase/votes';
import { logVotesRevealed } from '@/lib/supabase/game-events';
import { canVote } from '@/lib/domain/game-state-machine';
import { calculateVoteResult, wouldBeFifthRejection } from '@/lib/domain/vote-calculator';
import { errors, handleError } from '@/lib/utils/errors';
import {
  broadcastVoteSubmitted,
  broadcastPhaseTransition,
  broadcastGameOver,
} from '@/lib/broadcast';
import type { VoteRequest, VoteResponse, VoteInfo } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/games/[gameId]/vote
 * Submit vote on current proposal
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return errors.unauthorized();
    }

    // Parse request body
    const body = await request.json() as VoteRequest;
    const { vote } = body;

    if (!vote || !['approve', 'reject'].includes(vote)) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'vote must be "approve" or "reject"' } },
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
    if (!canVote(game.phase)) {
      return NextResponse.json(
        { error: { code: 'INVALID_PHASE', message: 'Cannot vote in current phase' } },
        { status: 400 }
      );
    }

    // Get current proposal
    const proposal = await getCurrentProposal(supabase, gameId);
    if (!proposal) {
      return NextResponse.json(
        { error: { code: 'NO_PROPOSAL', message: 'No active proposal to vote on' } },
        { status: 400 }
      );
    }

    // Submit vote (will throw if already voted)
    try {
      await submitVote(supabase, {
        proposal_id: proposal.id,
        player_id: user.id,
        vote,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'ALREADY_VOTED') {
        return NextResponse.json(
          { error: { code: 'ALREADY_VOTED', message: 'You have already voted' } },
          { status: 400 }
        );
      }
      throw err;
    }

    // Get vote count
    const votesSubmitted = await getVoteCount(supabase, proposal.id);
    const totalPlayers = game.player_count;

    // Feature 016: Broadcast vote submission (FR-002)
    await broadcastVoteSubmitted(gameId, user.id, votesSubmitted, totalPlayers);

    // Check if all votes are in
    if (votesSubmitted === totalPlayers) {
      // Calculate vote result
      const totals = await calculateVoteTotals(supabase, proposal.id);
      const result = calculateVoteResult(totals.approve, totals.reject, totalPlayers);

      // Get votes for logging
      const { data: votesData } = await supabase
        .from('votes')
        .select(`
          player_id,
          vote,
          players!inner (display_name)
        `)
        .eq('proposal_id', proposal.id);

      const voteInfos: VoteInfo[] = (votesData || []).map((v) => {
        const players = v.players as { display_name: string } | { display_name: string }[] | null;
        const displayName = Array.isArray(players)
          ? players[0]?.display_name || 'Unknown'
          : players?.display_name || 'Unknown';
        return {
          player_id: v.player_id,
          display_name: displayName,
          vote: v.vote as 'approve' | 'reject',
        };
      });

      // Resolve proposal
      await resolveProposal(
        supabase,
        proposal.id,
        result.status,
        result.approveCount,
        result.rejectCount
      );

      // Log votes revealed
      await logVotesRevealed(supabase, gameId, {
        proposal_id: proposal.id,
        votes: voteInfos,
        result: result.status,
        approve_count: result.approveCount,
        reject_count: result.rejectCount,
      });

      if (result.isApproved) {
        // Team approved - reset vote track and move to quest phase
        const { error: updateError } = await supabase
          .from('games')
          .update({
            phase: 'quest',
            vote_track: 0,
          })
          .eq('id', gameId)
          .eq('phase', 'voting');

        if (updateError) {
          console.log('Vote result already processed by another request');
        } else {
          await broadcastPhaseTransition(
            gameId,
            'quest',
            'voting',
            'proposal_approved',
            game.current_quest
          );
        }
      } else {
        // Team rejected
        const newVoteTrack = game.vote_track + 1;

        if (wouldBeFifthRejection(game.vote_track)) {
          await endGame(supabase, gameId, 'evil', '5_rejections');
          await broadcastGameOver(gameId, 'evil', '5_rejections');
        } else {
          const nextLeaderIndex = (game.leader_index + 1) % game.seating_order.length;
          const nextLeaderId = game.seating_order[nextLeaderIndex];

          const { error: updateError } = await supabase
            .from('games')
            .update({
              phase: 'team_building',
              vote_track: newVoteTrack,
              leader_index: nextLeaderIndex,
              current_leader_id: nextLeaderId,
            })
            .eq('id', gameId)
            .eq('phase', 'voting');

          if (updateError) {
            console.log('Vote result already processed by another request');
          } else {
            await broadcastPhaseTransition(
              gameId,
              'team_building',
              'voting',
              'proposal_rejected',
              game.current_quest
            );
          }
        }
      }
    }

    const response: VoteResponse = {
      recorded: true,
      votes_submitted: votesSubmitted,
      total_players: totalPlayers,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    return handleError(error);
  }
}
