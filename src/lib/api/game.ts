/**
 * Game API client functions
 *
 * Auth is handled via Supabase session cookies — no custom headers needed.
 */

import type {
  ProposeTeamRequest,
  ProposeTeamResponse,
  VoteRequest,
  VoteResponse,
  QuestActionRequest,
  QuestActionResponse,
  ContinueGameResponse,
  VoteChoice,
  QuestActionType,
  UpdateDraftTeamRequest,
  UpdateDraftTeamResponse,
} from '@/types/game';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Propose a team for the current quest (leader only)
 */
export async function proposeTeam(
  gameId: string,
  teamMemberIds: string[]
): Promise<ProposeTeamResponse> {
  const body: ProposeTeamRequest = {
    team_member_ids: teamMemberIds,
  };

  const response = await fetch(`/api/games/${gameId}/propose`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || 'Failed to propose team');
  }

  const { data } = await response.json();
  return data;
}

/**
 * Submit vote on current proposal
 */
export async function submitVote(
  gameId: string,
  vote: VoteChoice
): Promise<VoteResponse> {
  const body: VoteRequest = { vote };

  const response = await fetch(`/api/games/${gameId}/vote`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || 'Failed to submit vote');
  }

  const { data } = await response.json();
  return data;
}

/**
 * Submit quest action (team members only)
 */
export async function submitQuestAction(
  gameId: string,
  action: QuestActionType
): Promise<QuestActionResponse> {
  const body: QuestActionRequest = { action };

  const response = await fetch(`/api/games/${gameId}/quest/action`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || 'Failed to submit action');
  }

  const { data } = await response.json();
  return data;
}

/**
 * Continue to next quest (after viewing results)
 */
export async function continueGame(gameId: string): Promise<ContinueGameResponse> {
  const response = await fetch(`/api/games/${gameId}/continue`, {
    method: 'POST',
    headers: JSON_HEADERS,
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || 'Failed to continue game');
  }

  const { data } = await response.json();
  return data;
}

/**
 * Get game for room (convenience function)
 */
export async function getGameForRoom(
  roomCode: string
): Promise<{ has_game: boolean; game_id: string | null; phase: string | null }> {
  const response = await fetch(`/api/rooms/${roomCode}/game`);

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || 'Failed to get game');
  }

  const { data } = await response.json();
  return data;
}

// ============================================
// FEATURE 007: DRAFT TEAM SELECTION
// ============================================

/**
 * Update the leader's draft team selection
 */
export async function updateDraftTeam(
  gameId: string,
  teamMemberIds: string[]
): Promise<UpdateDraftTeamResponse> {
  const body: UpdateDraftTeamRequest = {
    team_member_ids: teamMemberIds,
  };

  const response = await fetch(`/api/games/${gameId}/draft-team`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json();
    const errorCode = data.error?.code;
    const errorMessage = data.error?.message;

    if (errorCode === 'NOT_LEADER') {
      throw new Error('Only the current leader can update team selection');
    }
    if (errorCode === 'INVALID_PHASE') {
      throw new Error('Cannot update draft team in current phase');
    }
    if (errorCode === 'INVALID_TEAM_SIZE' || errorCode === 'INVALID_PLAYER_ID') {
      throw new Error(errorMessage || 'Invalid team selection');
    }

    throw new Error(errorMessage || 'Failed to update draft team');
  }

  return response.json();
}
