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
 * Timer: 50s countdown (30s for a smart bot), auto-advance when it hits 0 (no
 * auto-mute — the manager force-mutes manually; see forceMuteParticipant in
 * useLiveKit). A bot that has finished hands its turn on early (SPEAKER_DONE_TOPIC);
 * the rules are in src/lib/domain/speaking-turn.ts.
 * Manager controls: start timer (auto-advance + auto-reset)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useLiveKit } from './useLiveKit';
import { acceptsHandOn, SPEAKING_SECONDS, SPEAKER_DONE_TOPIC, speakingSeconds } from '@/lib/domain/speaking-turn';

const TIMER_DURATION = SPEAKING_SECONDS;
const TIMER_TOPIC = 'speaking-timer';

export interface SpeakingTimerState {
  speakingOrder: string[];
  currentSpeakerIndex: number;
  timerRunning: boolean;
  timerStartTime: number | null;
  timerDuration: number;
  questNumber: number;
  /** True during the one-time intro round (Feature 023). Lets the reviewer file
   *  these turns separately so they don't collide with Quest 1's turns. Optional:
   *  absent/false = a normal proposal round. */
  isIntro?: boolean;
  /** Which proposal of the quest this order's talk is about: the game's vote
   *  track when the order began (0 in the intro). Stated, so every listener
   *  files a turn under the same round, even one that joined late. */
  round?: number;
}

interface UseSpeakingTimerOptions {
  isManager: boolean;
  seatNumbers?: Map<string, number>;
  leaderIdentity?: string;
  questNumber: number;
  /** Feature 023: true while the game is in the one-time intro round. */
  inIntroPhase?: boolean;
  /** The game's vote track: the order's round. */
  voteTrack?: number;
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
 * Leader first → random second (excluding leader) → clockwise skipping leader → leader last.
 *
 * During the intro round (`isIntro`), the trailing leader turn is omitted: the
 * order ends on the last non-leader. The manager then ends the intro and the
 * leader speaks again as the first proposer of Quest 1, so a closing leader turn
 * here would be redundant.
 */
function generateSpeakingOrder(
  seatNumbers: Map<string, number>,
  leaderIdentity: string,
  isIntro = false
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

  // Leader first, then clockwise others. Quest rounds close with the leader
  // again; the intro round stops on the last non-leader.
  return isIntro
    ? [leaderIdentity, ...clockwise]
    : [leaderIdentity, ...clockwise, leaderIdentity];
}

/** The next speaker's turn, not started; past the last speaker, the order is done. */
function nextSpeaker(prev: SpeakingTimerState): SpeakingTimerState {
  return {
    ...prev,
    currentSpeakerIndex: Math.min(prev.currentSpeakerIndex + 1, prev.speakingOrder.length),
    timerRunning: false,
    timerStartTime: null,
  };
}

export function useSpeakingTimer({
  isManager,
  seatNumbers,
  leaderIdentity,
  questNumber,
  inIntroPhase = false,
  voteTrack = 0,
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
  const advancedRef = useRef(false);
  // Track the (leader + intro-flag) we last generated the order for.
  // Regenerating on leader change handles all rotation triggers (rejected
  // proposal, new quest, Lady investigation); adding the intro-flag also gives
  // the intro round and Quest 1's first proposal each their own fresh order.
  const generatedKeyRef = useRef<string | null>(null);

  // Broadcast helper
  const broadcast = useCallback(
    (s: SpeakingTimerState) => {
      if (!room) return;
      const payload = new TextEncoder().encode(JSON.stringify(s));
      room.localParticipant.publishData(payload, { topic: TIMER_TOPIC }).catch((err) => {
        console.warn('[speaking-timer] broadcast failed:', err);
      });
    },
    [room]
  );

  // Generate speaking order whenever the leader changes (manager only).
  // Leader rotates on: rejected proposal, new quest, Lady investigation — all handled here.
  useEffect(() => {
    if (!isManager || !seatNumbers || !leaderIdentity || seatNumbers.size === 0) return;
    if (questNumber === 0) return;
    // Regenerate when the leader changes OR when we cross the intro→play boundary
    // (same leader, but a fresh pass). Skip otherwise to avoid re-gen on re-renders.
    const genKey = `${leaderIdentity}:${inIntroPhase ? 'intro' : 'play'}`;
    if (genKey === generatedKeyRef.current && state.speakingOrder.length > 0) return;
    generatedKeyRef.current = genKey;

    const order = generateSpeakingOrder(seatNumbers, leaderIdentity, inIntroPhase);
    const newState: SpeakingTimerState = {
      speakingOrder: order,
      currentSpeakerIndex: 0,
      timerRunning: false,
      timerStartTime: null,
      timerDuration: TIMER_DURATION,
      questNumber,
      isIntro: inIntroPhase,
      round: inIntroPhase ? 0 : voteTrack,
    };
    setState(newState);
    broadcast(newState);
  }, [isManager, seatNumbers, leaderIdentity, questNumber, inIntroPhase, voteTrack, broadcast]);

  // Listen for state updates from manager
  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TIMER_TOPIC) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as SpeakingTimerState;
        setState(data);
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

  // Advance to next speaker.
  // When past the last speaker, set the index to speakingOrder.length so
  // `currentSpeaker` resolves to null (done state) instead of sticking on the leader.
  const advanceToNext = useCallback(() => {
    if (!isManager) return;
    setState((prev) => {
      const newState = nextSpeaker(prev);
      pendingBroadcastRef.current = newState;
      advancedRef.current = false;
      return newState;
    });
  }, [isManager]);

  // A bot's "done": checked against the latest state inside the update, so a
  // "done" that crosses the auto-advance or the manager's skip can't advance twice.
  const handOn = useCallback((senderIdentity: string | undefined) => {
    if (!isManager) return;
    setState((prev) => {
      if (!acceptsHandOn(prev, senderIdentity)) return prev;
      const newState = nextSpeaker(prev);
      pendingBroadcastRef.current = newState;
      advancedRef.current = false;
      return newState;
    });
  }, [isManager]);

  // A bot that has finished hands its turn on (manager only acts): the same
  // move as the manager's skip, accepted only from the speaker whose clock runs.
  useEffect(() => {
    if (!room || !isManager) return;
    const handleHandOn = (_payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic === SPEAKER_DONE_TOPIC) handOn(participant?.identity);
    };
    room.on(RoomEvent.DataReceived, handleHandOn);
    return () => {
      room.off(RoomEvent.DataReceived, handleHandOn);
    };
  }, [room, isManager, handOn]);

  // Timer countdown
  useEffect(() => {
    if (!state.timerRunning || !state.timerStartTime) {
      setTimeRemaining(null);
      return;
    }

    // Reset guard when timer starts
    advancedRef.current = false;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - state.timerStartTime!) / 1000;
      const remaining = Math.max(0, state.timerDuration - elapsed);
      setTimeRemaining(remaining);

      // Auto-advance the moment the timer hits 0 (manager only, guard prevents repeated calls)
      if (elapsed >= state.timerDuration && isManager && !advancedRef.current) {
        advancedRef.current = true;
        advanceToNext();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [state.timerRunning, state.timerStartTime, state.timerDuration, isManager, advanceToNext]);

  // Start timer (manager only). No-op when all speakers done.
  const startTimer = useCallback(() => {
    if (!isManager) return;
    setState((prev) => {
      if (prev.currentSpeakerIndex >= prev.speakingOrder.length) return prev;
      const newState: SpeakingTimerState = {
        ...prev,
        timerRunning: true,
        timerStartTime: Date.now(),
        timerDuration: speakingSeconds(prev.speakingOrder[prev.currentSpeakerIndex]),
      };
      pendingBroadcastRef.current = newState;
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
