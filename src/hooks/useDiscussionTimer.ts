'use client';

/**
 * useDiscussionTimer — the assassin-phase deliberation timer.
 *
 * One shared 2-minute window during which evil players discuss who the
 * assassin should pick. Different semantics from useSpeakingTimer:
 *   - single countdown (no per-speaker rotation),
 *   - scoped to `phase === 'assassin'`,
 *   - the focus tile is the assassin's video tile (not a rotating speaker).
 *
 * Wire:
 *   - manager broadcasts state on the 'discussion-timer' LiveKit topic,
 *   - every client listens + renders the countdown on the assassin's tile,
 *   - good players' mic + camera get locked for the duration via
 *     `setControlsLocked(true)`; evil players are free to unmute and
 *     turn on camera as they wish.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useLiveKit } from './useLiveKit';

export const DISCUSSION_TIMER_TOPIC = 'discussion-timer';

export const DEFAULT_DISCUSSION_DURATION_SEC = Number.parseInt(
  process.env.NEXT_PUBLIC_DISCUSSION_DURATION_SEC ?? '120',
  10
);

export interface DiscussionTimerState {
  startedAt: number | null;     // ms epoch when discussion began, null when idle
  durationSec: number;
  running: boolean;
  assassinIdentity: string | null;
}

interface UseDiscussionTimerOptions {
  /** Only the manager can start / reset the discussion timer. */
  isManager: boolean;
  /** Whether we're in the assassin phase; when false the hook stays idle. */
  enabled: boolean;
  /** The caller's own role — good players get auto-locked during discussion. */
  playerRole: 'good' | 'evil' | null;
  /** The assassin's LiveKit identity (from the server's assassin_phase block). */
  assassinIdentity: string | null;
}

export interface UseDiscussionTimerReturn {
  /** Assassin identity, so the UI can highlight their tile. */
  currentSpeaker: string | null;
  /** Seconds left until auto-stop, or null when idle. */
  timeRemaining: number | null;
  /** Color for the ring (mirrors useSpeakingTimer's palette). */
  timerColor: 'green' | 'yellow' | 'red' | null;
  /** 0..1 progress for the ring. */
  timerProgress: number | null;
  /** Manager action — broadcast start. */
  startTimer: () => void;
  /** Manager action — broadcast reset (ends early). */
  skipToNext: () => void;
  /** True while the timer is running. */
  running: boolean;
}

const emptyState = (durationSec: number): DiscussionTimerState => ({
  startedAt: null,
  durationSec,
  running: false,
  assassinIdentity: null,
});

export function useDiscussionTimer({
  isManager,
  enabled,
  playerRole,
  assassinIdentity,
}: UseDiscussionTimerOptions): UseDiscussionTimerReturn {
  const { room, setControlsLocked } = useLiveKit();
  const [state, setState] = useState<DiscussionTimerState>(() =>
    emptyState(DEFAULT_DISCUSSION_DURATION_SEC)
  );
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  // Track lock ownership so we only toggle when WE turned it on.
  const lockedByUsRef = useRef(false);

  // Broadcast helper (manager only).
  const broadcast = useCallback(
    (s: DiscussionTimerState) => {
      if (!room) return;
      const payload = new TextEncoder().encode(JSON.stringify(s));
      room.localParticipant
        .publishData(payload, { topic: DISCUSSION_TIMER_TOPIC, reliable: true })
        .catch((err) => {
          console.warn('[discussion-timer] broadcast failed:', err);
        });
    },
    [room]
  );

  // Listen for peer broadcasts.
  useEffect(() => {
    if (!room) return;
    const handleData = (
      payload: Uint8Array,
      _p?: RemoteParticipant,
      _k?: unknown,
      topic?: string
    ) => {
      if (topic !== DISCUSSION_TIMER_TOPIC) return;
      try {
        const next = JSON.parse(new TextDecoder().decode(payload)) as DiscussionTimerState;
        setState(next);
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Reset local state when we leave the assassin phase.
  useEffect(() => {
    if (!enabled) {
      setState(emptyState(DEFAULT_DISCUSSION_DURATION_SEC));
      setTimeRemaining(null);
      if (lockedByUsRef.current) {
        setControlsLocked(false);
        lockedByUsRef.current = false;
      }
    }
  }, [enabled, setControlsLocked]);

  // Countdown + auto-stop (only the manager broadcasts the stop).
  useEffect(() => {
    if (!state.running || state.startedAt === null) {
      setTimeRemaining(null);
      return;
    }
    const handle = setInterval(() => {
      const elapsed = (Date.now() - (state.startedAt ?? 0)) / 1000;
      const remaining = Math.max(0, state.durationSec - elapsed);
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(handle);
        if (isManager) {
          const stopped: DiscussionTimerState = {
            ...state,
            startedAt: null,
            running: false,
          };
          setState(stopped);
          broadcast(stopped);
        }
      }
    }, 200);
    return () => clearInterval(handle);
  }, [state, isManager, broadcast]);

  // Good-player lock: force-mute + camera-off for good players while the
  // discussion is running; release the lock the moment any input flips —
  // including `playerRole` arriving late as 'evil' after a default-'good'
  // initial render (happens on a page refresh during discussion).
  //
  // We only own (set/unset) the lock when WE were the ones who turned it on,
  // so we don't clobber an unrelated role-reveal lock that might be active.
  useEffect(() => {
    const shouldBeLocked = state.running && playerRole === 'good';
    if (shouldBeLocked !== lockedByUsRef.current) {
      setControlsLocked(shouldBeLocked);
      lockedByUsRef.current = shouldBeLocked;
    }
  }, [state.running, playerRole, setControlsLocked]);

  const startTimer = useCallback(() => {
    if (!isManager || !enabled) return;
    const next: DiscussionTimerState = {
      startedAt: Date.now(),
      durationSec: DEFAULT_DISCUSSION_DURATION_SEC,
      running: true,
      assassinIdentity,
    };
    setState(next);
    broadcast(next);
  }, [isManager, enabled, assassinIdentity, broadcast]);

  const skipToNext = useCallback(() => {
    if (!isManager) return;
    const next: DiscussionTimerState = {
      ...state,
      startedAt: null,
      running: false,
    };
    setState(next);
    broadcast(next);
  }, [isManager, state, broadcast]);

  // Map to the same shape speakingTimer produces so the game page can
  // seamlessly swap one for the other during assassin phase.
  let timerColor: 'green' | 'yellow' | 'red' | null = null;
  let timerProgress: number | null = null;
  if (timeRemaining !== null) {
    timerProgress = timeRemaining / state.durationSec;
    if (timeRemaining > state.durationSec * 0.4) timerColor = 'green';
    else if (timeRemaining > state.durationSec * 0.2) timerColor = 'yellow';
    else timerColor = 'red';
  } else if (state.assassinIdentity) {
    timerColor = 'green';
    timerProgress = 1;
  }

  return {
    currentSpeaker: state.running ? state.assassinIdentity : null,
    timeRemaining,
    timerColor,
    timerProgress,
    startTimer,
    skipToNext,
    running: state.running,
  };
}
