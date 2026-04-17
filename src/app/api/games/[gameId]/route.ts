/**
 * API Route: GET /api/games/[gameId]
 * Get full game state
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getCurrentProposal, getActiveProposalForQuest } from '@/lib/supabase/proposals';
import { getPlayerVote, getVotedPlayerIds, getVotesForProposal } from '@/lib/supabase/votes';
import { getActionCount, hasPlayerSubmittedAction } from '@/lib/supabase/quest-actions';
import { getInvestigatedPlayerIds, getLastInvestigation, getPreviousLadyHolderIds } from '@/lib/supabase/lady-investigations';
import { getPlayerRole } from '@/lib/supabase/roles';
import { getQuestRequirementsMap } from '@/lib/domain/quest-config';
import { isLadyPhase } from '@/lib/domain/game-state-machine';
import { getConnectionStatus } from '@/lib/domain/connection-status';
import { errors, handleError } from '@/lib/utils/errors';
import type { GameState, GamePlayer, LadyOfLakeState } from '@/types/game';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * GET /api/games/[gameId]
 * Get full game state for client
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

    // Get room code for display
    const { data: room } = await supabase
      .from('rooms')
      .select('code, manager_id')
      .eq('id', game.room_id)
      .single();
    const roomCode = room?.code || null;
    const isManager = room?.manager_id === user.id;

    // Verify player is in this game
    if (!game.seating_order.includes(user.id)) {
      return NextResponse.json(
        { error: { code: 'NOT_IN_GAME', message: 'You are not in this game' } },
        { status: 403 }
      );
    }

    // Get current proposal - use active proposal for quest phases
    let currentProposal = null;
    if (game.phase === 'quest' || game.phase === 'quest_result') {
      currentProposal = await getActiveProposalForQuest(supabase, gameId, game.current_quest);
    } else {
      currentProposal = await getCurrentProposal(supabase, gameId);
    }

    // Get player display names and activity for seating display
    const { data: playersData } = await supabase
      .from('players')
      .select('id, display_name, last_activity_at')
      .in('id', game.seating_order);

    const displayNameMap = new Map(
      (playersData || []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])
    );

    const activityMap = new Map(
      (playersData || []).map((p: { id: string; last_activity_at?: string }) => [p.id, p.last_activity_at])
    );

    // Get voted player IDs if in voting phase
    let votedPlayerIds: string[] = [];
    if (game.phase === 'voting' && currentProposal) {
      votedPlayerIds = await getVotedPlayerIds(supabase, currentProposal.id);
    }

    // Get player's vote on current proposal
    let myVote = null;
    if (currentProposal) {
      const vote = await getPlayerVote(supabase, currentProposal.id, user.id);
      myVote = vote?.vote || null;
    }

    // Get last vote result (for reveal animation after voting)
    let lastVoteResult = null;
    if (game.phase === 'quest' || game.phase === 'team_building') {
      const { data: recentProposal } = await supabase
        .from('team_proposals')
        .select('*')
        .eq('game_id', gameId)
        .neq('status', 'pending')
        .order('resolved_at', { ascending: false })
        .limit(1)
        .single();

      if (recentProposal) {
        const voteInfos = await getVotesForProposal(supabase, recentProposal.id);
        lastVoteResult = {
          proposal_id: recentProposal.id,
          is_approved: recentProposal.status === 'approved',
          approve_count: recentProposal.approve_count,
          reject_count: recentProposal.reject_count,
          votes: voteInfos,
        };
      }
    }

    // Check if player is on quest team
    const amTeamMember = currentProposal?.team_member_ids.includes(user.id) || false;

    // Get action submission state if in quest phase
    let canSubmitAction = false;
    let hasSubmittedAction = false;
    let actionsSubmitted = 0;
    let totalTeamMembers = 0;

    if (game.phase === 'quest' && currentProposal) {
      totalTeamMembers = currentProposal.team_member_ids.length;
      actionsSubmitted = await getActionCount(supabase, gameId, game.current_quest);

      if (amTeamMember) {
        hasSubmittedAction = await hasPlayerSubmittedAction(
          supabase,
          gameId,
          game.current_quest,
          user.id
        );
        canSubmitAction = !hasSubmittedAction;
      }
    }

    // Get all player roles (for revealing at game end or assassin phase)
    let playerRolesMap = new Map<string, { role: string; special_role: string | null }>();
    if (game.phase === 'game_over' || game.phase === 'assassin') {
      const { data: allRoles } = await supabase
        .from('player_roles')
        .select('player_id, role, special_role')
        .eq('room_id', game.room_id);

      if (allRoles) {
        playerRolesMap = new Map(
          allRoles.map((pr: { player_id: string; role: string; special_role: string | null }) =>
            [pr.player_id, { role: pr.role, special_role: pr.special_role }]
          )
        );
      }
    }

    // Build game players list
    const players: GamePlayer[] = game.seating_order.map((pid, index) => {
      const roleInfo = playerRolesMap.get(pid);
      const lastActivity = activityMap.get(pid);
      const connectionStatus = lastActivity
        ? getConnectionStatus(lastActivity)
        : { is_connected: true, seconds_since_activity: 0 };

      const wasMixedGroup = game.phase === 'game_over' && (
        game.split_intel_mixed_evil_id === pid || game.split_intel_mixed_good_id === pid
      ) ? true : undefined;

      const wasMixedGroupWithOberon = game.phase === 'game_over' &&
        game.oberon_split_intel_mixed_good_id === pid ? true : undefined;

      return {
        id: pid,
        display_name: displayNameMap.get(pid) || 'Unknown',
        seat_position: index,
        is_leader: pid === game.current_leader_id,
        is_on_team: currentProposal?.team_member_ids.includes(pid) || false,
        has_voted: votedPlayerIds.includes(pid),
        is_connected: connectionStatus.is_connected,
        revealed_role: game.phase === 'game_over' ? (roleInfo?.role as 'good' | 'evil') : undefined,
        revealed_special_role: game.phase === 'game_over' ? roleInfo?.special_role ?? undefined : undefined,
        was_decoy: game.phase === 'game_over' && game.merlin_decoy_player_id === pid ? true : undefined,
        was_mixed_group: wasMixedGroup,
        was_mixed_group_with_oberon: wasMixedGroupWithOberon,
      };
    });

    // Get quest requirement for current quest
    const questRequirements = getQuestRequirementsMap(game.player_count);
    const questRequirement = questRequirements[game.current_quest];

    // Get current player's role (for UI like fail button)
    const playerRoleData = await getPlayerRole(supabase, game.room_id, user.id);
    const playerRole = playerRoleData?.role || 'good';
    const specialRole = playerRoleData?.special_role || null;

    // Build assassin phase state if in assassin phase
    let assassinPhase = null;
    let isAssassin = false;
    if (game.phase === 'assassin') {
      const { data: assassinData } = await supabase
        .from('player_roles')
        .select('player_id')
        .eq('room_id', game.room_id)
        .eq('special_role', 'assassin')
        .single();

      const { data: merlinData } = await supabase
        .from('player_roles')
        .select('player_id')
        .eq('room_id', game.room_id)
        .eq('special_role', 'merlin')
        .single();

      if (assassinData && merlinData) {
        const assassinDisplayName = displayNameMap.get(assassinData.player_id) || 'Unknown';
        assassinPhase = {
          assassin_id: assassinData.player_id,
          assassin_display_name: assassinDisplayName,
          merlin_id: merlinData.player_id,
          can_guess: user.id === assassinData.player_id,
        };
        isAssassin = user.id === assassinData.player_id;
      }
    }

    // Build Lady of the Lake state
    let ladyOfLake: LadyOfLakeState | null = null;
    if (game.lady_enabled === true) {
      const [investigatedIds, previousHolderIds, lastInvestigation] = await Promise.all([
        getInvestigatedPlayerIds(supabase, gameId),
        getPreviousLadyHolderIds(supabase, gameId),
        getLastInvestigation(supabase, gameId),
      ]);

      let lastInvestigationInfo = null;
      if (lastInvestigation) {
        const investigatorDisplayName = displayNameMap.get(lastInvestigation.investigator_id) || 'Unknown';
        const targetDisplayName = displayNameMap.get(lastInvestigation.target_id) || 'Unknown';
        lastInvestigationInfo = {
          investigator_display_name: investigatorDisplayName,
          target_display_name: targetDisplayName,
        };
      }

      const holderDisplayName = game.lady_holder_id
        ? displayNameMap.get(game.lady_holder_id) || 'Unknown'
        : null;

      ladyOfLake = {
        enabled: true,
        holder_id: game.lady_holder_id,
        holder_display_name: holderDisplayName,
        investigated_player_ids: investigatedIds,
        previous_lady_holder_ids: previousHolderIds,
        is_holder: user.id === game.lady_holder_id,
        can_investigate: isLadyPhase(game.phase) && user.id === game.lady_holder_id,
        last_investigation: lastInvestigationInfo,
      };
    }

    // Feature 007: Calculate is_draft_in_progress
    const isDraftInProgress = game.draft_team !== null && game.draft_team !== undefined && (game.draft_team as string[]).length > 0;

    const gameState: GameState = {
      game,
      players,
      current_proposal: currentProposal,
      quest_requirement: questRequirement,
      my_vote: myVote,
      am_team_member: amTeamMember,
      can_submit_action: canSubmitAction,
      has_submitted_action: hasSubmittedAction,
      votes_submitted: votedPlayerIds.length,
      total_players: game.player_count,
      actions_submitted: actionsSubmitted,
      total_team_members: totalTeamMembers,
      last_vote_result: lastVoteResult,
      assassin_phase: assassinPhase,
      is_assassin: isAssassin,
      lady_of_lake: ladyOfLake,
      draft_team: game.draft_team ?? null,
      is_draft_in_progress: isDraftInProgress,
    };

    return NextResponse.json({
      data: gameState,
      current_user_id: user.id,
      player_role: playerRole,
      special_role: specialRole,
      room_code: roomCode,
      is_manager: isManager,
    });
  } catch (error) {
    return handleError(error);
  }
}
