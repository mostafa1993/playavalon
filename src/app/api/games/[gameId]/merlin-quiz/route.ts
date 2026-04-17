/**
 * API Routes: /api/games/[gameId]/merlin-quiz
 * Feature 010: Endgame Merlin Quiz
 *
 * POST - Submit a quiz vote
 * GET - Get current quiz state
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import {
  submitQuizVote,
  getQuizVotes,
  getQuizVoteCount,
  getPlayerQuizVote,
  getQuizStartTime,
} from '@/lib/supabase/merlin-quiz';
import {
  QUIZ_TIMEOUT_SECONDS,
  canShowQuiz,
  validateQuizVote,
  isQuizComplete,
  getPlayerVoteStatus,
} from '@/lib/domain/merlin-quiz';
import { errors, handleError } from '@/lib/utils/errors';
import type { MerlinQuizState, MerlinQuizVoteResponse } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/games/[gameId]/merlin-quiz
 * Submit a quiz vote for who the player thinks is Merlin
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

    // Verify game is in game_over phase
    if (game.phase !== 'game_over') {
      return NextResponse.json(
        { error: { code: 'INVALID_PHASE', message: 'Quiz is only available at game over' } },
        { status: 400 }
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
        { error: { code: 'NO_MERLIN', message: 'This game does not have a Merlin role' } },
        { status: 404 }
      );
    }

    // Check if player already voted
    const existingVote = await getPlayerQuizVote(supabase, gameId, user.id);
    if (existingVote) {
      return NextResponse.json(
        { error: { code: 'ALREADY_VOTED', message: 'You have already submitted your guess' } },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const suspectedPlayerId = body.suspected_player_id ?? null;

    // Validate vote
    const validation = validateQuizVote(user.id, suspectedPlayerId, game.seating_order);
    if (!validation.valid) {
      const errorMessages: Record<string, string> = {
        CANNOT_VOTE_SELF: 'You cannot vote for yourself',
        INVALID_PLAYER: 'Selected player is not in this game',
        VOTER_NOT_IN_GAME: 'You are not in this game',
      };
      return NextResponse.json(
        { error: { code: validation.error, message: errorMessages[validation.error!] || 'Invalid vote' } },
        { status: 400 }
      );
    }

    // Submit vote
    await submitQuizVote(supabase, {
      game_id: gameId,
      voter_player_id: user.id,
      suspected_player_id: suspectedPlayerId,
    });

    // Get updated vote count and check completion
    const [voteCount, quizStartTime] = await Promise.all([
      getQuizVoteCount(supabase, gameId),
      getQuizStartTime(supabase, gameId),
    ]);

    // Get connected players count
    const { data: roomPlayers } = await supabase
      .from('room_players')
      .select('player_id, players!inner(last_activity_at)')
      .eq('room_id', game.room_id);

    const connectedCount = (roomPlayers || []).filter(rp => {
      const lastActivity = (rp.players as { last_activity_at?: string })?.last_activity_at;
      if (!lastActivity) return true;
      const timeSince = Date.now() - new Date(lastActivity).getTime();
      return timeSince < 60000;
    }).length;

    const quizComplete = isQuizComplete(voteCount, connectedCount, quizStartTime);

    const response: MerlinQuizVoteResponse = {
      success: true,
      votes_submitted: voteCount,
      total_players: game.player_count,
      quiz_complete: quizComplete,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * GET /api/games/[gameId]/merlin-quiz
 * Get current quiz state
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

    const hasMerlin = !!merlinRole;
    const quizEnabled = canShowQuiz(hasMerlin) && game.phase === 'game_over';

    if (!quizEnabled) {
      const state: MerlinQuizState = {
        quiz_enabled: false,
        quiz_active: false,
        quiz_complete: false,
        my_vote: null,
        has_voted: false,
        has_skipped: false,
        votes_submitted: 0,
        total_players: game.player_count,
        connected_players: game.player_count,
        quiz_started_at: null,
        timeout_seconds: QUIZ_TIMEOUT_SECONDS,
      };
      return NextResponse.json({ data: state });
    }

    const [votes, quizStartTime] = await Promise.all([
      getQuizVotes(supabase, gameId),
      getQuizStartTime(supabase, gameId),
    ]);

    const { data: roomPlayers } = await supabase
      .from('room_players')
      .select('player_id, players!inner(last_activity_at)')
      .eq('room_id', game.room_id);

    const connectedCount = (roomPlayers || []).filter(rp => {
      const lastActivity = (rp.players as { last_activity_at?: string })?.last_activity_at;
      if (!lastActivity) return true;
      const timeSince = Date.now() - new Date(lastActivity).getTime();
      return timeSince < 60000;
    }).length;

    const voteStatus = getPlayerVoteStatus(votes, user.id);

    const quizComplete = isQuizComplete(votes.length, connectedCount, quizStartTime);
    const quizActive = quizEnabled && !quizComplete;

    const state: MerlinQuizState = {
      quiz_enabled: true,
      quiz_active: quizActive,
      quiz_complete: quizComplete,
      my_vote: voteStatus.hasSkipped ? 'skipped' : voteStatus.votedFor,
      has_voted: voteStatus.hasVoted,
      has_skipped: voteStatus.hasSkipped,
      votes_submitted: votes.length,
      total_players: game.player_count,
      connected_players: connectedCount,
      quiz_started_at: quizStartTime,
      timeout_seconds: QUIZ_TIMEOUT_SECONDS,
    };

    return NextResponse.json({ data: state });
  } catch (error) {
    return handleError(error);
  }
}
