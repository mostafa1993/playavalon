/**
 * Broadcast Types for Real-Time Updates
 * Feature 016: Real-Time Broadcast Updates
 *
 * TypeScript type definitions for Supabase Realtime Broadcast events.
 * These types enable type-safe handling of real-time game updates.
 */

import type { GamePhase, WinReason } from './game';

// ============================================
// BROADCAST EVENT TYPES
// ============================================

/**
 * All possible broadcast event types
 */
export type BroadcastEventType =
  | 'draft_update' // Leader's team selection changed
  | 'vote_submitted' // A player submitted their vote
  | 'action_submitted' // A team member submitted quest action
  | 'phase_transition' // Game phase changed
  | 'game_over'; // Game ended

// ============================================
// EVENT PAYLOADS
// ============================================

/**
 * Payload for draft_update event
 * Sent when leader selects/deselects players for the team
 *
 * Security: Contains only player IDs (public information)
 */
export interface DraftUpdatePayload {
  draft_team: string[]; // Array of selected player database IDs
}

/**
 * Payload for vote_submitted event
 * Sent when a player submits their vote
 *
 * Security: Does NOT include the vote value (approve/reject)
 */
export interface VoteSubmittedPayload {
  player_id: string; // ID of player who voted
  votes_count: number; // Total votes submitted so far
  total_players: number; // Total players in game
}

/**
 * Payload for action_submitted event
 * Sent when a team member submits their quest action
 *
 * Security: Does NOT include the action type (success/fail)
 */
export interface ActionSubmittedPayload {
  actions_count: number; // Total actions submitted so far
  total_team_members: number; // Team size for current quest
}

/**
 * Payload for phase_transition event
 * Sent when game phase changes
 */
export interface PhaseTransitionPayload {
  phase: GamePhase; // New game phase
  previous_phase: GamePhase; // Previous phase
  trigger: PhaseTransitionTrigger; // What caused the transition
  quest_number: number; // Current quest number
}

/**
 * What caused a phase transition
 */
export type PhaseTransitionTrigger =
  | 'proposal_submitted' // Leader submitted team proposal
  | 'proposal_approved' // Voting passed, team approved
  | 'proposal_rejected' // Voting failed, rotating leader
  | 'quest_complete' // All actions submitted
  | 'quest_result_shown' // Continue button pressed
  | 'lady_complete' // Lady investigation done
  | 'assassin_phase' // Good won 3, assassin's turn
  | 'game_ended' // Game is over
  | 'intro_ended'; // Feature 023: manager ended the intro round, propose is now allowed

/**
 * Payload for game_over event
 * Sent when game ends
 */
export interface GameOverPayload {
  winner: 'good' | 'evil';
  reason: WinReason;
}

// ============================================
// UNION TYPES
// ============================================

/**
 * Union type for all broadcast payloads
 */
export type BroadcastPayload =
  | DraftUpdatePayload
  | VoteSubmittedPayload
  | ActionSubmittedPayload
  | PhaseTransitionPayload
  | GameOverPayload;

/**
 * Discriminated union for type-safe event handling
 * Use this when processing received broadcasts
 */
export type BroadcastMessage =
  | { event: 'draft_update'; payload: DraftUpdatePayload }
  | { event: 'vote_submitted'; payload: VoteSubmittedPayload }
  | { event: 'action_submitted'; payload: ActionSubmittedPayload }
  | { event: 'phase_transition'; payload: PhaseTransitionPayload }
  | { event: 'game_over'; payload: GameOverPayload };

// ============================================
// CHANNEL TYPES
// ============================================

/**
 * Active channel tracking (server-side)
 * Used by channel manager for lifecycle management
 */
export interface ActiveChannel {
  gameId: string;
  channelName: string;
  createdAt: Date;
  lastActivity: Date;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Channel connection status
 */
export type ChannelStatus =
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CLOSED'
  | 'CHANNEL_ERROR';

// ============================================
// BROADCAST HANDLER TYPES
// ============================================

/**
 * Handler function type for broadcast events
 */
export type BroadcastHandler<T extends BroadcastPayload> = (payload: T) => void;

/**
 * All handlers for broadcast channel subscription
 */
export interface BroadcastHandlers {
  onDraftUpdate?: BroadcastHandler<DraftUpdatePayload>;
  onVoteSubmitted?: BroadcastHandler<VoteSubmittedPayload>;
  onActionSubmitted?: BroadcastHandler<ActionSubmittedPayload>;
  onPhaseTransition?: BroadcastHandler<PhaseTransitionPayload>;
  onGameOver?: BroadcastHandler<GameOverPayload>;
  onConnectionChange?: (status: ChannelStatus, error?: Error) => void;
}

// ============================================
// CONSTANTS
// ============================================

/**
 * Channel name prefix for game broadcasts
 */
export const BROADCAST_CHANNEL_PREFIX = 'game:';

/**
 * Minimum debounce interval between broadcasts (ms)
 */
export const BROADCAST_DEBOUNCE_MS = 50;

/**
 * Channel inactivity timeout (ms) - 2 hours
 */
export const CHANNEL_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * Generate channel name for a game
 */
export function getChannelName(gameId: string): string {
  return `${BROADCAST_CHANNEL_PREFIX}${gameId}`;
}
