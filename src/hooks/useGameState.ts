/**
 * useGameState hook
 * Manages game state with polling updates
 * T073: Updated for Phase 6 to detect session takeover
 * Feature 016: Added real-time broadcast subscription for instant updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState } from '@/types/game';
import { getPlayerId } from '@/lib/utils/player-id';
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
  currentPlayerId: string | null;
  playerRole: 'good' | 'evil';
  specialRole: string | null;
  roomCode: string | null;
  isManager: boolean;
  loading: boolean;
  error: string | null;
  /** T073: Session was taken over by another device */
  sessionTakenOver: boolean;
  refetch: () => Promise<void>;
}

export function useGameState(gameId: string | null): UseGameStateResult {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [playerRole, setPlayerRole] = useState<'good' | 'evil'>('good');
  const [specialRole, setSpecialRole] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // T073: Session takeover detection
  const [sessionTakenOver, setSessionTakenOver] = useState(false);
  const hadGameAccessRef = useRef<boolean>(false);

  // Feature 016: Broadcast handlers for real-time updates
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
      // Update votes_submitted count and mark the player as voted
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
      // On phase transition, trigger a full refetch to get accurate state
      // This ensures we have the complete state for the new phase
      // eslint-disable-next-line no-console
      console.log(
        `[Broadcast] Phase transition: ${payload.previous_phase} → ${payload.phase}`
      );
      // Refetch will be called via the effect dependency
      fetchGameStateRef.current?.();
    },
    []
  );

  const handleGameOver = useCallback((payload: GameOverPayload) => {
    // On game over, trigger a full refetch to get final state with revealed roles
    // eslint-disable-next-line no-console
    console.log(`[Broadcast] Game over: ${payload.winner} wins (${payload.reason})`);
    fetchGameStateRef.current?.();
  }, []);

  // Store fetchGameState in ref for use in broadcast handlers
  const fetchGameStateRef = useRef<(() => Promise<void>) | null>(null);

  // Feature 016: Subscribe to broadcast channel
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
      setCurrentPlayerId(null);
      setLoading(false);
      return;
    }

    try {
      const playerId = getPlayerId();
      const response = await fetch(`/api/games/${gameId}`, {
        headers: { 'X-Player-ID': playerId },
      });

      if (!response.ok) {
        const data = await response.json();
        const errorCode = data.error?.code;

        // T073: Detect session takeover - if we previously had access but now don't
        if (hadGameAccessRef.current &&
            (errorCode === 'NOT_IN_GAME' || response.status === 403)) {
          setSessionTakenOver(true);
          return;
        }

        throw new Error(data.error?.message || 'Failed to fetch game state');
      }

      const responseData = await response.json();
      setGameState(responseData.data);
      setCurrentPlayerId(responseData.current_player_id);
      setPlayerRole(responseData.player_role || 'good');
      setSpecialRole(responseData.special_role || null);
      setRoomCode(responseData.room_code || null);
      setIsManager(responseData.is_manager || false);
      setError(null);
      // Mark that we had successful access
      hadGameAccessRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  // Store fetchGameState ref for broadcast handlers
  fetchGameStateRef.current = fetchGameState;

  // Initial fetch and polling
  // Note: Polling continues even with broadcast connection (FR-007 fallback)
  useEffect(() => {
    fetchGameState();

    const interval = setInterval(fetchGameState, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchGameState]);

  return {
    gameState,
    currentPlayerId,
    playerRole,
    specialRole,
    roomCode,
    isManager,
    loading,
    error,
    sessionTakenOver,
    refetch: fetchGameState,
  };
}
