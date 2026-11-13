'use client';

/**
 * usePlayAgain hook
 * The game-over screen's way into the next game: the "Play again" press, the
 * automatic move of a screen that saw the game end, and "Join next game".
 *
 * Every way in joins the next room first. Only when the join succeeds does it
 * leave the old video call and open the lobby, so a refused player keeps their
 * call and stays on this screen with the reason.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveKit } from '@/hooks/useLiveKit';
import { nextRoomAction, joinRefusalMessage, type NextRoomAction } from '@/lib/domain/play-again';
import type { NextRoomState, PlayAgainResult } from '@/types/game';

/** How often, and how many times, to ask again while another player creates the room */
const ASK_AGAIN_MS = 1000;
const MAX_ASKS = 15;

export interface PlayAgainControls {
  /** A player of this game has opened the next room (whatever its state now) */
  hasNextRoom: boolean;
  action: NextRoomAction;
  /** Joining (or creating) the next game is under way */
  busy: boolean;
  /** Why the last attempt failed */
  error: string | null;
  playAgain: () => void;
  joinNextGame: () => void;
}

interface UsePlayAgainOptions {
  gameId: string;
  nextRoom: NextRoomState | null;
  sawGameEnd: boolean;
  endedAt: string | null;
}

export function usePlayAgain({ gameId, nextRoom, sawGameEnd, endedAt }: UsePlayAgainOptions): PlayAgainControls {
  const router = useRouter();
  const { disconnect } = useLiveKit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveTried, setMoveTried] = useState(false);
  const moveTriedRef = useRef(false);
  // Once this page sees its player in the next room, it never moves them
  // again — a player who joined from another tab and then left stays out.
  const [seenAsMember, setSeenAsMember] = useState(false);
  useEffect(() => {
    if (nextRoom?.is_member) setSeenAsMember(true);
  }, [nextRoom?.is_member]);

  const action = nextRoomAction({
    sawGameEnd,
    msSinceGameEnd: endedAt ? Date.now() - new Date(endedAt).getTime() : null,
    moveTried,
    seenAsMember,
    nextRoomStatus: nextRoom?.status ?? null,
    isMember: nextRoom?.is_member ?? false,
  });

  /** Join, then leave the old call and open the lobby. False when refused. */
  const enter = useCallback(async (code: string): Promise<boolean> => {
    const response = await fetch(`/api/rooms/${code}/join`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(joinRefusalMessage(body?.error?.code));
      return false;
    }
    disconnect();
    router.push(`/rooms/${code}`);
    return true;
  }, [disconnect, router]);

  /** Run one attempt; stays busy on success, while the lobby opens */
  const attempt = useCallback(async (run: () => Promise<boolean>) => {
    setBusy(true);
    setError(null);
    try {
      if (!(await run())) setBusy(false);
    } catch {
      setError('Could not join the next game');
      setBusy(false);
    }
  }, []);

  // The automatic move, tried once
  const nextRoomCode = nextRoom?.code ?? null;
  useEffect(() => {
    if (action !== 'move' || !nextRoomCode || moveTriedRef.current) return;
    moveTriedRef.current = true;
    setMoveTried(true);
    void attempt(() => enter(nextRoomCode));
  }, [action, nextRoomCode, attempt, enter]);

  const playAgain = useCallback(() => {
    void attempt(async () => {
      for (let ask = 0; ask < MAX_ASKS; ask++) {
        const response = await fetch(`/api/games/${gameId}/play-again`, { method: 'POST' });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.error?.message || 'Could not open the next game');
          return false;
        }
        const result = body.data as PlayAgainResult;
        if (result.room_code) {
          return enter(result.room_code);
        }
        // Another player is creating it
        await new Promise((resolve) => setTimeout(resolve, ASK_AGAIN_MS));
      }
      setError('The next game is taking long to open. Try again.');
      return false;
    });
  }, [attempt, enter, gameId]);

  const joinNextGame = useCallback(() => {
    if (!nextRoomCode) return;
    void attempt(() => enter(nextRoomCode));
  }, [attempt, enter, nextRoomCode]);

  return {
    hasNextRoom: nextRoom !== null,
    action,
    busy,
    error,
    playAgain,
    joinNextGame,
  };
}
