/**
 * useGameState hook
 * Manages game state with polling updates and broadcast subscription.
 * Auth is via cookies.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState } from '@/types/game';
import { useBroadcastChannel } from './useBroadcastChannel';
import type {
  DraftUpdatePayload,
  VoteSubmittedPayload,
  ActionSubmittedPayload,
  PhaseTransitionPayload,
  GameOverPayload,
} from '@/types/broadcast';

const POLL_INTERVAL = 3000; // 3 seconds

interface UseGameStateResult {
  gameState: GameState | null;
  currentUserId: string | null;
  playerRole: 'good' | 'evil';
  specialRole: string | null;
  roomCode: string | null;
  isManager: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGameState(gameId: string | null): UseGameStateResult {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [playerRole, setPlayerRole] = useState<'good' | 'evil'>('good');
  const [specialRole, setSpecialRole] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Broadcast handlers for real-time updates
  const handleDraftUpdate = useCallback((payload: DraftUpdatePayload) => {
    setGameState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        draft_team: payload.draft_team,
        is_draft_in_progress: payload.draft_team.length > 0,
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
        `[Broadcast] Phase transition: ${payload.previous_phase} → ${payload.phase}`
      );
      fetchGameStateRef.current?.();
    },
    []
  );

  const handleGameOver = useCallback((payload: GameOverPayload) => {
    // eslint-disable-next-line no-console
    console.log(`[Broadcast] Game over: ${payload.winner} wins (${payload.reason})`);
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
      setCurrentUserId(null);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/games/${gameId}`);

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to fetch game state');
      }

      const responseData = await response.json();
      setGameState(responseData.data);
      setCurrentUserId(responseData.current_user_id);
      setPlayerRole(responseData.player_role || 'good');
      setSpecialRole(responseData.special_role || null);
      setRoomCode(responseData.room_code || null);
      setIsManager(responseData.is_manager || false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  fetchGameStateRef.current = fetchGameState;

  useEffect(() => {
    fetchGameState();

    const interval = setInterval(fetchGameState, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchGameState]);

  return {
    gameState,
    currentUserId,
    playerRole,
    specialRole,
    roomCode,
    isManager,
    loading,
    error,
    refetch: fetchGameState,
  };
}
