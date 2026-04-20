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

/** Structured LLM output for one speaking turn. */
export interface TurnSummary {
  key_points: string[];
  claims: string[];
  suspicions: Array<{ target: string; reason: string }>;
  defenses: Array<{ subject: string; reason: string }>;
  stance: 'supports' | 'opposes' | 'neutral' | 'unclear';
  notable_quotes: string[];
}

/** Written to turn_<q>_<i>.json after STT + summarizer complete. */
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
  /** Undefined if summarization was skipped or failed. */
  summary?: TurnSummary;
}

/** Evolving per-player memory, written to dossier_<playerId>.json. */
export interface DossierJson {
  playerId: string;
  playerDisplayName: string;
  lastQuestNumber: number;
  lastTurnIndex: number;
  updatedAt: string;
  behavior_arc: string[];
  stated_claims: string[];
  contradictions: string[];
  alliance_patterns: string[];
  key_moments: string[];
}

/** Structured LLM output for one quest. */
export interface QuestSynthesis {
  quest_number: number;
  leader_display_name: string;
  proposals: Array<{
    proposal_number: number;
    team: string[];
    approvals: string[];
    rejections: string[];
    status: 'approved' | 'rejected';
  }>;
  mission: null | {
    team: string[];
    success_count: number;
    fail_count: number;
    result: 'success' | 'fail';
  };
  narrative_summary: string;
  turning_points: string[];
  mvp: { player: string; reason: string } | null;
  suspicious_players: Array<{ player: string; reason: string }>;
}

/** Written to quest_<n>.json after the quest completes and synthesis runs. */
export interface QuestJson extends QuestSynthesis {
  gameId: string;
  completedAt: string;
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
