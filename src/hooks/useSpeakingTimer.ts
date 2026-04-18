'use client';

/**
 * useSpeakingTimer — manages the speaking turn order and timer
 *
 * Turn order per quest:
 * 1. Leader speaks first (proposes team + explains)
 * 2. Random second speaker (excluding leader)
 * 3. Clockwise from there, skipping leader
 * 4. Leader speaks last (defends)
 *
 * Timer: 50s countdown, auto-mute at 55s
 * Manager controls: start timer (auto-advance + auto-reset)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useLiveKit } from './useLiveKit';

const TIMER_DURATION = 50; // seconds
const AUTO_MUTE_DELAY = 5; // seconds after timer ends
const TIMER_TOPIC = 'speaking-timer';

export interface SpeakingTimerState {
  speakingOrder: string[];
  currentSpeakerIndex: number;
  timerRunning: boolean;
  timerStartTime: number | null;
  timerDuration: number;
  questNumber: number;
}

interface UseSpeakingTimerOptions {
  isManager: boolean;
  seatNumbers?: Map<string, number>;
  leaderIdentity?: string;
  questNumber: number;
}

interface UseSpeakingTimerReturn {
  currentSpeaker: string | null;
  timeRemaining: number | null;
  timerColor: 'green' | 'yellow' | 'red' | null;
  timerProgress: number | null;
  startTimer: () => void;
  skipToNext: () => void;
  speakingOrder: string[];
  currentIndex: number;
}

/**
 * Generate speaking order:
 * Leader first → random second (excluding leader) → clockwise skipping leader → leader last
 */
function generateSpeakingOrder(
  seatNumbers: Map<string, number>,
  leaderIdentity: string
): string[] {
  const sorted = [...seatNumbers.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([identity]) => identity);

  const others = sorted.filter((id) => id !== leaderIdentity);

  if (others.length === 0) return [leaderIdentity];

  // Pick random second speaker from non-leaders
  const randomIndex = Math.floor(Math.random() * others.length);
  const secondSpeaker = others[randomIndex];
  const secondSeatNum = seatNumbers.get(secondSpeaker)!;

  // Build clockwise order starting from second speaker
  // Sort others by seat number relative to secondSpeaker, wrapping around
  const totalSeats = seatNumbers.size;
  const clockwise = [...others].sort((a, b) => {
    const seatA = seatNumbers.get(a)!;
    const seatB = seatNumbers.get(b)!;
    const relA = ((seatA - secondSeatNum + totalSeats) % totalSeats);
    const relB = ((seatB - secondSeatNum + totalSeats) % totalSeats);
    return relA - relB;
  });

  // Leader first, then clockwise others, then leader last
  return [leaderIdentity, ...clockwise, leaderIdentity];
}

export function useSpeakingTimer({
  isManager,
  seatNumbers,
  leaderIdentity,
  questNumber,
}: UseSpeakingTimerOptions): UseSpeakingTimerReturn {
  const { room } = useLiveKit();
  const [state, setState] = useState<SpeakingTimerState>({
    speakingOrder: [],
    currentSpeakerIndex: 0,
    timerRunning: false,
    timerStartTime: null,
    timerDuration: TIMER_DURATION,
    questNumber: 0,
  });
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const autoMutedRef = useRef(false);
  const advancedRef = useRef(false);
  const generatedForQuestRef = useRef(0);

  // Broadcast helper
  const broadcast = useCallback(
    (s: SpeakingTimerState) => {
      if (!room) return;
      const payload = new TextEncoder().encode(JSON.stringify(s));
      room.localParticipant.publishData(payload, { topic: TIMER_TOPIC });
    },
    [room]
  );

  // Generate speaking order when quest changes (manager only)
  useEffect(() => {
    console.log('[SpeakingTimer] Check:', {
      isManager,
      hasSeatNumbers: !!seatNumbers,
      seatNumbersSize: seatNumbers?.size,
      leaderIdentity,
      questNumber,
      generatedFor: generatedForQuestRef.current,
    });
    if (!isManager || !seatNumbers || !leaderIdentity || seatNumbers.size === 0) return;
    if (questNumber === 0) return;
    // Re-generate if quest changed OR if we haven't generated yet (late isManager/seatNumbers arrival)
    if (questNumber === generatedForQuestRef.current && state.speakingOrder.length > 0) return;
    generatedForQuestRef.current = questNumber;

    const order = generateSpeakingOrder(seatNumbers, leaderIdentity);
    console.log('[SpeakingTimer] Generated order:', order, 'seatNumbers:', [...seatNumbers.entries()]);
    const newState: SpeakingTimerState = {
      speakingOrder: order,
      currentSpeakerIndex: 0,
      timerRunning: false,
      timerStartTime: null,
      timerDuration: TIMER_DURATION,
      questNumber,
    };
    setState(newState);
    broadcast(newState);
  }, [isManager, seatNumbers, leaderIdentity, questNumber, broadcast]);

  // Listen for state updates from manager
  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TIMER_TOPIC) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as SpeakingTimerState;
        setState(data);
        autoMutedRef.current = false;
        advancedRef.current = false;
      } catch {}
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Track pending broadcast
  const pendingBroadcastRef = useRef<SpeakingTimerState | null>(null);

  // Broadcast state changes via effect (clean side-effect handling)
  useEffect(() => {
    if (pendingBroadcastRef.current) {
      broadcast(pendingBroadcastRef.current);
      pendingBroadcastRef.current = null;
    }
  }, [state, broadcast]);

  // Advance to next speaker
  const advanceToNext = useCallback(() => {
    if (!isManager) return;

    setState((prev) => {
      const nextIndex = prev.currentSpeakerIndex + 1;
      const newState: SpeakingTimerState = {
        ...prev,
        currentSpeakerIndex: nextIndex >= prev.speakingOrder.length ? prev.currentSpeakerIndex : nextIndex,
        timerRunning: false,
        timerStartTime: null,
      };
      pendingBroadcastRef.current = newState;
      autoMutedRef.current = false;
      advancedRef.current = false;
      return newState;
    });
  }, [isManager]);

  // Timer countdown
  useEffect(() => {
    if (!state.timerRunning || !state.timerStartTime) {
      setTimeRemaining(null);
      return;
    }

    // Reset guards when timer starts
    advancedRef.current = false;
    autoMutedRef.current = false;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - state.timerStartTime!) / 1000;
      const remaining = Math.max(0, state.timerDuration - elapsed);
      setTimeRemaining(remaining);

      // Auto-mute at timerDuration + AUTO_MUTE_DELAY
      if (elapsed >= state.timerDuration + AUTO_MUTE_DELAY && !autoMutedRef.current) {
        autoMutedRef.current = true;
        if (room && state.speakingOrder[state.currentSpeakerIndex] === room.localParticipant.identity) {
          room.localParticipant.setMicrophoneEnabled(false);
        }
      }

      // Auto-advance once after auto-mute (manager only, guard prevents repeated calls)
      if (elapsed >= state.timerDuration + AUTO_MUTE_DELAY && isManager && !advancedRef.current) {
        advancedRef.current = true;
        advanceToNext();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [state.timerRunning, state.timerStartTime, state.timerDuration, state.currentSpeakerIndex, room, isManager, advanceToNext, state.speakingOrder]);

  // Start timer (manager only)
  const startTimer = useCallback(() => {
    if (!isManager) return;
    setState((prev) => {
      const newState: SpeakingTimerState = {
        ...prev,
        timerRunning: true,
        timerStartTime: Date.now(),
      };
      pendingBroadcastRef.current = newState;
      autoMutedRef.current = false;
      advancedRef.current = false;
      return newState;
    });
  }, [isManager]);

  // Compute timer color and progress
  let timerColor: 'green' | 'yellow' | 'red' | null = null;
  let timerProgress: number | null = null;

  if (timeRemaining !== null) {
    timerProgress = timeRemaining / state.timerDuration;
    if (timeRemaining > 20) timerColor = 'green';
    else if (timeRemaining > 10) timerColor = 'yellow';
    else timerColor = 'red';
  } else if (state.speakingOrder.length > 0 && state.currentSpeakerIndex < state.speakingOrder.length) {
    timerColor = 'green';
    timerProgress = 1;
  }

  const currentSpeaker =
    state.speakingOrder.length > 0 && state.currentSpeakerIndex < state.speakingOrder.length
      ? state.speakingOrder[state.currentSpeakerIndex]
      : null;

  return {
    currentSpeaker,
    timeRemaining,
    timerColor,
    timerProgress,
    startTimer,
    skipToNext: advanceToNext,
    speakingOrder: state.speakingOrder,
    currentIndex: state.currentSpeakerIndex,
  };
}
