'use client';

/**
 * Room data hook with polling-based state synchronization.
 * Auth is via cookies — no headers needed on fetches.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { RoomDetails, RoomPlayerInfo } from '@/types/room';

// Polling interval in milliseconds (3 seconds for near-real-time feel)
const POLL_INTERVAL_MS = 3000;

interface UseRoomReturn {
  /** Room details including players */
  room: RoomDetails | null;
  /** Whether loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether polling is active */
  isConnected: boolean;
  /** Roles in play for this game */
  rolesInPlay: string[];
  /** Lady of the Lake holder info */
  ladyOfLakeHolder: { id: string; display_name: string } | null;
  /** Refresh room data */
  refresh: () => Promise<void>;
  /** Leave the room */
  leave: () => Promise<boolean>;
}

/**
 * Hook for managing room data with fast polling
 */
export function useRoom(roomCode: string): UseRoomReturn {
  const [room, setRoom] = useState<RoomDetails | null>(null);
  const [rolesInPlay, setRolesInPlay] = useState<string[]>([]);
  const [ladyOfLakeHolder, setLadyOfLakeHolder] = useState<{ id: string; display_name: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const lastFetchRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);

  const fetchRoom = useCallback(async (force = false) => {
    if (isFetchingRef.current && !force) {
      return null;
    }

    const now = Date.now();
    if (!force && now - lastFetchRef.current < 1000) {
      return null;
    }

    isFetchingRef.current = true;
    lastFetchRef.current = now;

    try {
      const response = await fetch(`/api/rooms/${roomCode}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to fetch room');
      }

      const { data } = await response.json();
      setRoom(data);
      setRolesInPlay(data.roles_in_play || []);
      setLadyOfLakeHolder(data.lady_of_lake_holder || null);
      setError(null);
      setIsConnected(true);

      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch room');
      setIsConnected(false);
      return null;
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [roomCode]);

  const leave = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/rooms/${roomCode}/leave`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to leave room');
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
      return false;
    }
  }, [roomCode]);

  useEffect(() => {
    fetchRoom(true);
  }, [fetchRoom]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      fetchRoom();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(pollInterval);
  }, [fetchRoom]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchRoom(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchRoom]);

  useEffect(() => {
    const handleFocus = () => {
      fetchRoom(true);
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchRoom]);

  return {
    room,
    isLoading,
    error,
    isConnected,
    rolesInPlay,
    ladyOfLakeHolder,
    refresh: () => fetchRoom(true),
    leave,
  };
}

/**
 * Get player info for specific player in room
 */
export function getPlayerInfo(
  room: RoomDetails | null,
  userId: string
): RoomPlayerInfo | null {
  if (!room) return null;
  return room.players.find((p) => p.id === userId) ?? null;
}
