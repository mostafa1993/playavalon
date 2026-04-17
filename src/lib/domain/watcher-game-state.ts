/**
 * Watcher Game State Builder
 * Feature 015: Build neutral observer view of game state
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Game, TeamProposal, QuestRequirement } from '@/types/game';
import type {
  WatcherGameState,
  WatcherPlayerInfo,
  WatcherLadyState,
} from '@/types/watcher';
import { getQuestRequirementsMap } from './quest-config';
import { getConnectionStatus } from './connection-status';

/**
 * Build game state for a watcher (neutral observer view)
 */
export async function buildWatcherGameState(
  supabase: SupabaseClient,
  game: Game,
  currentProposal: TeamProposal | null,
  votedPlayerIds: string[],
  lastVoteResult: WatcherGameState['last_vote_result'],
  playersData: Array<{ id: string; display_name: string; last_activity_at?: string }>
): Promise<WatcherGameState> {
  const displayNameMap = new Map(
    playersData.map((p) => [p.id, p.display_name])
  );
  const activityMap = new Map(
    playersData.map((p) => [p.id, p.last_activity_at])
  );

  const questRequirements = getQuestRequirementsMap(game.player_count);
  const questRequirement: QuestRequirement = questRequirements[game.current_quest];

  const players: WatcherPlayerInfo[] = await buildWatcherPlayerList(
    supabase,
    game,
    currentProposal,
    votedPlayerIds,
    displayNameMap,
    activityMap
  );

  const ladyOfLake = await buildWatcherLadyState(supabase, game, displayNameMap);

  const votesSubmitted = votedPlayerIds.length;
  const totalPlayers = game.player_count;

  let actionsSubmitted = 0;
  let totalTeamMembers = 0;

  if (game.phase === 'quest' && currentProposal) {
    totalTeamMembers = currentProposal.team_member_ids.length;

    const { count } = await supabase
      .from('quest_actions')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', game.id)
      .eq('quest_number', game.current_quest);

    actionsSubmitted = count ?? 0;
  }

  return {
    game,
    players,
    current_proposal: currentProposal,
    quest_requirement: questRequirement,
    votes_submitted: votesSubmitted,
    total_players: totalPlayers,
    actions_submitted: actionsSubmitted,
    total_team_members: totalTeamMembers,
    last_vote_result: lastVoteResult,
    lady_of_lake: ladyOfLake,
    draft_team: game.draft_team ?? null,
  };
}

async function buildWatcherPlayerList(
  supabase: SupabaseClient,
  game: Game,
  currentProposal: TeamProposal | null,
  votedPlayerIds: string[],
  displayNameMap: Map<string, string>,
  activityMap: Map<string, string | undefined>
): Promise<WatcherPlayerInfo[]> {
  let playerRolesMap = new Map<string, { role: string; special_role: string | null }>();

  if (game.phase === 'game_over') {
    const { data: allRoles } = await supabase
      .from('player_roles')
      .select('player_id, role, special_role')
      .eq('room_id', game.room_id);

    if (allRoles) {
      playerRolesMap = new Map(
        allRoles.map((pr: { player_id: string; role: string; special_role: string | null }) => [
          pr.player_id,
          { role: pr.role, special_role: pr.special_role },
        ])
      );
    }
  }

  return game.seating_order.map((pid, index) => {
    const lastActivity = activityMap.get(pid);
    const connectionStatus = lastActivity
      ? getConnectionStatus(lastActivity)
      : { is_connected: true, seconds_since_activity: 0 };

    const roleInfo = playerRolesMap.get(pid);

    return {
      id: pid,
      display_name: displayNameMap.get(pid) || 'Unknown',
      seat_position: index,
      is_leader: pid === game.current_leader_id,
      is_on_team: currentProposal?.team_member_ids.includes(pid) || false,
      has_voted: votedPlayerIds.includes(pid),
      is_connected: connectionStatus.is_connected,
      revealed_role:
        game.phase === 'game_over'
          ? (roleInfo?.role as 'good' | 'evil')
          : undefined,
      revealed_special_role:
        game.phase === 'game_over' ? roleInfo?.special_role ?? undefined : undefined,
    };
  });
}

async function buildWatcherLadyState(
  supabase: SupabaseClient,
  game: Game,
  displayNameMap: Map<string, string>
): Promise<WatcherLadyState | null> {
  if (!game.lady_enabled) {
    return null;
  }

  const { data: lastInvestigation } = await supabase
    .from('lady_investigations')
    .select('investigator_id, target_id')
    .eq('game_id', game.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let lastInvestigationInfo = null;
  if (lastInvestigation) {
    lastInvestigationInfo = {
      investigator_display_name:
        displayNameMap.get(lastInvestigation.investigator_id) || 'Unknown',
      target_display_name:
        displayNameMap.get(lastInvestigation.target_id) || 'Unknown',
    };
  }

  const holderDisplayName = game.lady_holder_id
    ? displayNameMap.get(game.lady_holder_id) || 'Unknown'
    : null;

  return {
    enabled: true,
    holder_display_name: holderDisplayName,
    last_investigation: lastInvestigationInfo,
  };
}
