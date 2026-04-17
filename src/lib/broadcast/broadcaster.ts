/**
 * Server-Side Broadcaster
 * Feature 016: Real-Time Broadcast Updates
 *
 * Sends broadcast messages to all connected clients via Supabase Realtime.
 * All broadcasts happen AFTER successful database writes (FR-011).
 */

import { createServiceClient } from '@/lib/supabase/server';
import {
  getChannelName,
  type BroadcastEventType,
  type DraftUpdatePayload,
  type VoteSubmittedPayload,
  type ActionSubmittedPayload,
  type PhaseTransitionPayload,
  type GameOverPayload,
  type PhaseTransitionTrigger,
} from '@/types/broadcast';
import type { GamePhase, WinReason } from '@/types/game';
import { debouncedBroadcast } from './debounce';
import { formatEventForLog } from './event-types';

// ============================================
// LOGGING
// ============================================

/**
 * Log broadcast events (FR-015)
 */
function logBroadcast(
  event: BroadcastEventType,
  gameId: string,
  success: boolean,
  error?: Error
): void {
  const message = formatEventForLog(event, gameId);
  if (success) {
    // eslint-disable-next-line no-console
    console.log(message);
  } else {
    // eslint-disable-next-line no-console
    console.error(`${message} - FAILED:`, error?.message || 'Unknown error');
  }
}

// ============================================
// BASE BROADCAST FUNCTION
// ============================================

/**
 * Send a broadcast event to all subscribers of a game channel
 *
 * @param gameId - The game UUID
 * @param event - The event type
 * @param payload - The event payload
 */
async function sendBroadcast<T>(
  gameId: string,
  event: BroadcastEventType,
  payload: T
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const channelName = getChannelName(gameId);

    // Create or get channel and send broadcast
    const channel = supabase.channel(channelName);

    await channel.send({
      type: 'broadcast',
      event,
      payload,
    });

    logBroadcast(event, gameId, true);
  } catch (error) {
    // Log error but don't throw - broadcasts should not block API responses
    logBroadcast(
      event,
      gameId,
      false,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Generic broadcast function with debouncing
 * Use this for all broadcast calls to ensure consistent debouncing
 */
export async function broadcastEvent<T>(
  gameId: string,
  event: BroadcastEventType,
  payload: T
): Promise<void> {
  await debouncedBroadcast(gameId, event, payload, async (p) => {
    await sendBroadcast(gameId, event, p);
  });
}

// ============================================
// SPECIFIC BROADCAST FUNCTIONS
// ============================================
// These provide type-safe APIs for each event type

/**
 * Broadcast draft team selection change (FR-001)
 *
 * @param gameId - The game UUID
 * @param draftTeam - Array of selected player IDs
 */
export async function broadcastDraftUpdate(
  gameId: string,
  draftTeam: string[]
): Promise<void> {
  const payload: DraftUpdatePayload = {
    draft_team: draftTeam,
  };
  await broadcastEvent(gameId, 'draft_update', payload);
}

/**
 * Broadcast vote submission (FR-002)
 * Note: Does NOT include the vote value - only that the player voted
 *
 * @param gameId - The game UUID
 * @param playerId - The player who voted
 * @param votesCount - Total votes submitted so far
 * @param totalPlayers - Total players in game
 */
export async function broadcastVoteSubmitted(
  gameId: string,
  playerId: string,
  votesCount: number,
  totalPlayers: number
): Promise<void> {
  const payload: VoteSubmittedPayload = {
    player_id: playerId,
    votes_count: votesCount,
    total_players: totalPlayers,
  };
  await broadcastEvent(gameId, 'vote_submitted', payload);
}

/**
 * Broadcast quest action submission (FR-003)
 * Note: Does NOT include the action type - only the count
 *
 * @param gameId - The game UUID
 * @param actionsCount - Total actions submitted so far
 * @param totalTeamMembers - Team size for current quest
 */
export async function broadcastActionSubmitted(
  gameId: string,
  actionsCount: number,
  totalTeamMembers: number
): Promise<void> {
  const payload: ActionSubmittedPayload = {
    actions_count: actionsCount,
    total_team_members: totalTeamMembers,
  };
  await broadcastEvent(gameId, 'action_submitted', payload);
}

/**
 * Broadcast phase transition (FR-013)
 *
 * @param gameId - The game UUID
 * @param phase - New game phase
 * @param previousPhase - Previous phase
 * @param trigger - What caused the transition
 * @param questNumber - Current quest number
 */
export async function broadcastPhaseTransition(
  gameId: string,
  phase: GamePhase,
  previousPhase: GamePhase,
  trigger: PhaseTransitionTrigger,
  questNumber: number
): Promise<void> {
  const payload: PhaseTransitionPayload = {
    phase,
    previous_phase: previousPhase,
    trigger,
    quest_number: questNumber,
  };
  await broadcastEvent(gameId, 'phase_transition', payload);
}

/**
 * Broadcast game over (FR-014)
 *
 * @param gameId - The game UUID
 * @param winner - Winning team
 * @param reason - Win reason
 */
export async function broadcastGameOver(
  gameId: string,
  winner: 'good' | 'evil',
  reason: WinReason
): Promise<void> {
  const payload: GameOverPayload = {
    winner,
    reason,
  };
  await broadcastEvent(gameId, 'game_over', payload);
}
