/**
 * useBroadcastChannel Hook
 * Feature 016: Real-Time Broadcast Updates
 *
 * Client-side subscription hook for game broadcast channels.
 * Supplements polling with instant updates via Supabase Realtime Broadcast.
 *
 * FR-005: Auto-subscribe when viewing a game
 * FR-006: Auto-unsubscribe on disconnect/leave
 * FR-012: Handle reconnection automatically
 */

import { useEffect, useRef, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  getChannelName,
  type BroadcastHandlers,
  type ChannelStatus,
  type DraftUpdatePayload,
  type VoteSubmittedPayload,
  type ActionSubmittedPayload,
  type PhaseTransitionPayload,
  type GameOverPayload,
} from '@/types/broadcast';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================
// LOGGING HELPERS (FR-015)
// ============================================

/**
 * Log connection events for debugging
 */
function logConnectionEvent(
  gameId: string,
  status: ChannelStatus,
  error?: Error
): void {
  const base = `[Broadcast] Connection ${status} for game:${gameId}`;
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`${base} - Error:`, error.message);
  } else {
    // eslint-disable-next-line no-console
    console.log(base);
  }
}

// ============================================
// HOOK INTERFACE
// ============================================

export interface UseBroadcastChannelOptions {
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean;
}

export interface UseBroadcastChannelResult {
  /** Current connection status */
  isConnected: boolean;
  /** Last connection error (if any) */
  connectionError: Error | null;
}

// ============================================
// MAIN HOOK
// ============================================

/**
 * Subscribe to a game's broadcast channel
 *
 * @param gameId - The game UUID to subscribe to
 * @param handlers - Event handler callbacks
 * @param options - Optional configuration
 * @returns Connection status and error
 *
 * @example
 * ```tsx
 * const { isConnected } = useBroadcastChannel(gameId, {
 *   onDraftUpdate: (payload) => {
 *     setGameState(prev => ({ ...prev, draft_team: payload.draft_team }));
 *   },
 *   onVoteSubmitted: (payload) => {
 *     setGameState(prev => ({ ...prev, votes_submitted: payload.votes_count }));
 *   },
 * });
 * ```
 */
export function useBroadcastChannel(
  gameId: string | null,
  handlers: BroadcastHandlers,
  options: UseBroadcastChannelOptions = {}
): UseBroadcastChannelResult {
  const { enabled = true } = options;

  // Track channel reference for cleanup
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Track connection state
  const isConnectedRef = useRef(false);
  const connectionErrorRef = useRef<Error | null>(null);

  // Store handlers in ref to avoid re-subscribing on handler changes
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Stable callback for handling events
  const handleDraftUpdate = useCallback(
    (payload: { payload: DraftUpdatePayload }) => {
      handlersRef.current.onDraftUpdate?.(payload.payload);
    },
    []
  );

  const handleVoteSubmitted = useCallback(
    (payload: { payload: VoteSubmittedPayload }) => {
      handlersRef.current.onVoteSubmitted?.(payload.payload);
    },
    []
  );

  const handleActionSubmitted = useCallback(
    (payload: { payload: ActionSubmittedPayload }) => {
      handlersRef.current.onActionSubmitted?.(payload.payload);
    },
    []
  );

  const handlePhaseTransition = useCallback(
    (payload: { payload: PhaseTransitionPayload }) => {
      handlersRef.current.onPhaseTransition?.(payload.payload);
    },
    []
  );

  const handleGameOver = useCallback(
    (payload: { payload: GameOverPayload }) => {
      handlersRef.current.onGameOver?.(payload.payload);
    },
    []
  );

  // Subscribe effect
  useEffect(() => {
    // Don't subscribe if disabled or no gameId
    if (!enabled || !gameId) {
      return;
    }

    const supabase = getSupabaseClient();
    const channelName = getChannelName(gameId);

    // Create channel and subscribe to all events
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'draft_update' }, handleDraftUpdate)
      .on('broadcast', { event: 'vote_submitted' }, handleVoteSubmitted)
      .on('broadcast', { event: 'action_submitted' }, handleActionSubmitted)
      .on('broadcast', { event: 'phase_transition' }, handlePhaseTransition)
      .on('broadcast', { event: 'game_over' }, handleGameOver)
      .subscribe((status, err) => {
        // Map Supabase status to our ChannelStatus
        const channelStatus = status as ChannelStatus;

        switch (status) {
          case 'SUBSCRIBED':
            isConnectedRef.current = true;
            connectionErrorRef.current = null;
            logConnectionEvent(gameId, 'SUBSCRIBED');
            handlersRef.current.onConnectionChange?.('SUBSCRIBED');
            break;

          case 'CHANNEL_ERROR':
            isConnectedRef.current = false;
            connectionErrorRef.current =
              err instanceof Error ? err : new Error('Channel error');
            logConnectionEvent(gameId, 'CHANNEL_ERROR', connectionErrorRef.current);
            handlersRef.current.onConnectionChange?.(
              'CHANNEL_ERROR',
              connectionErrorRef.current
            );
            break;

          case 'TIMED_OUT':
            isConnectedRef.current = false;
            connectionErrorRef.current = new Error('Connection timed out');
            logConnectionEvent(gameId, 'TIMED_OUT', connectionErrorRef.current);
            handlersRef.current.onConnectionChange?.(
              'TIMED_OUT',
              connectionErrorRef.current
            );
            break;

          case 'CLOSED':
            isConnectedRef.current = false;
            logConnectionEvent(gameId, 'CLOSED');
            handlersRef.current.onConnectionChange?.('CLOSED');
            break;

          default:
            // Log any unexpected status
            // eslint-disable-next-line no-console
            console.log(`[Broadcast] Unknown status for game:${gameId}:`, channelStatus);
        }
      });

    channelRef.current = channel;

    // Cleanup on unmount or gameId change (FR-006)
    return () => {
      if (channelRef.current) {
        logConnectionEvent(gameId, 'CLOSED');
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        isConnectedRef.current = false;
      }
    };
  }, [
    gameId,
    enabled,
    handleDraftUpdate,
    handleVoteSubmitted,
    handleActionSubmitted,
    handlePhaseTransition,
    handleGameOver,
  ]);

  return {
    isConnected: isConnectedRef.current,
    connectionError: connectionErrorRef.current,
  };
}
