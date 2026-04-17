/**
 * useWatcherState hook
 * Feature 015: Manages watcher game state with polling updates
 * Auth via cookies — no custom headers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { WatcherGameState, UseWatcherStateResult } from '@/types/watcher';
import { WATCHER_POLL_INTERVAL_MS } from '@/types/watcher';
import { useBroadcastChannel } from './useBroadcastChannel';
import type {
  DraftUpdatePayload,
  VoteSubmittedPayload,
  ActionSubmittedPayload,
  PhaseTransitionPayload,
  GameOverPayload,
} from '@/types/broadcast';

/**
 * Auto-rejoin as watcher when session expires
 */
async function rejoinAsWatcher(gameId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/watch/${gameId}/join`, {
      method: 'POST',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Hook for managing watcher game state
 */
export function useWatcherState(gameId: string | null): UseWatcherStateResult {
  const [gameState, setGameState] = useState<WatcherGameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const rejoinAttemptRef = useRef(false);

  const handleDraftUpdate = useCallback((payload: DraftUpdatePayload) => {
    setGameState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        draft_team: payload.draft_team,
      };
    });
  }, []);

  const handleVoteSubmitted = useCallback((payload: VoteSubmittedPayload) => {
    setGameState((prev) => {
      if (!prev) return null;
      const updatedPlayers = prev.players.map((p) =>
        p.id === payload.player_id ? { ...p, has_voted: true } : p
      );
      return {
        ...prev,
        votes_submitted: payload.votes_count,
        players: updatedPlayers,
      };
    });
  }, []);

  const handleActionSubmitted = useCallback((payload: ActionSubmittedPayload) => {
    setGameState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        actions_submitted: payload.actions_count,
        total_team_members: payload.total_team_members,
      };
    });
  }, []);

  const handlePhaseTransition = useCallback(
    (payload: PhaseTransitionPayload) => {
      // eslint-disable-next-line no-console
      console.log(
        `[Watcher Broadcast] Phase transition: ${payload.previous_phase} → ${payload.phase}`
      );
      fetchGameStateRef.current?.();
    },
    []
  );

  const handleGameOver = useCallback((payload: GameOverPayload) => {
    // eslint-disable-next-line no-console
    console.log(`[Watcher Broadcast] Game over: ${payload.winner} wins (${payload.reason})`);
    fetchGameStateRef.current?.();
  }, []);

  const fetchGameStateRef = useRef<(() => Promise<void>) | null>(null);

  useBroadcastChannel(gameId, {
    onDraftUpdate: handleDraftUpdate,
    onVoteSubmitted: handleVoteSubmitted,
    onActionSubmitted: handleActionSubmitted,
    onPhaseTransition: handlePhaseTransition,
    onGameOver: handleGameOver,
  });

  const fetchGameState = useCallback(async () => {
    if (!gameId) {
      setGameState(null);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/watch/${gameId}`);

      if (!isMountedRef.current) return;

      if (!response.ok) {
        const data = await response.json();
        const errorCode = data.error?.code;

        if (errorCode === 'SESSION_EXPIRED' && !rejoinAttemptRef.current) {
          rejoinAttemptRef.current = true;
          const rejoined = await rejoinAsWatcher(gameId);
          rejoinAttemptRef.current = false;

          if (rejoined && isMountedRef.current) {
            const retryResponse = await fetch(`/api/watch/${gameId}`);
            if (retryResponse.ok && isMountedRef.current) {
              const retryData = await retryResponse.json();
              setGameState(retryData.data);
              setError(null);
              setLoading(false);
              return;
            }
          }
        }

        const errorMessage = data.error?.message || 'Failed to fetch game state';
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      setGameState(responseData.data);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [gameId]);

  fetchGameStateRef.current = fetchGameState;

  useEffect(() => {
    isMountedRef.current = true;

    fetchGameState();

    const interval = setInterval(fetchGameState, WATCHER_POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchGameState]);

  return {
    gameState,
    loading,
    error,
    refetch: fetchGameState,
  };
}
