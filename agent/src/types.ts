/**
 * Shared types for the reviewer agent.
 */

/** Mirrors the SpeakingTimerState broadcast by src/hooks/useSpeakingTimer.ts. */
export interface SpeakingTimerState {
  speakingOrder: string[];
  currentSpeakerIndex: number;
  timerRunning: boolean;
  timerStartTime: number | null;
  timerDuration: number;
  questNumber: number;
}

/** Minimal view of the game + players + roles pulled from Supabase. */
export interface GameMetaSnapshot {
  gameId: string;
  roomId: string;
  roomCode: string;
  playerCount: number;
  startedAt: string;
  seatingOrder: string[];
  firstLeaderId: string;
  players: Array<{
    id: string;
    display_name: string;
    role: 'good' | 'evil';
    special_role: string | null;
    seat_number: number | null;
  }>;
}

/** Written to meta.json when the agent first sees a game. */
export interface MetaJson {
  gameId: string;
  roomId: string;
  roomCode: string;
  playerCount: number;
  startedAt: string;
  seatingOrder: string[];
  firstLeaderId: string;
  players: GameMetaSnapshot['players'];
  agentStartedAt: string;
}

/** Written to turn_<q>_<i>.json after STT completes. */
export interface TurnJson {
  gameId: string;
  questNumber: number;
  turnIndex: number;
  speakerIdentity: string;
  speakerDisplayName: string;
  startedAt: string;
  durationSec: number;
  sampleRate: number;
  transcript: string;
  confidence: number | null;
  language: string;
}

/** One completed turn before STT has been applied. */
export interface RecordedTurn {
  questNumber: number;
  turnIndex: number;
  speakerIdentity: string;
  speakerDisplayName: string;
  startedAt: Date;
  durationSec: number;
  sampleRate: number;
  pcm: Int16Array;
}
