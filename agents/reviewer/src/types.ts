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
    /** Omitted in blind mode — the reviewer never reads player_roles there. */
    role?: 'good' | 'evil';
    special_role?: string | null;
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

/** Written to turn_<q>_<r>_<i>.json after STT + summarizer complete. */
export interface TurnJson {
  gameId: string;
  questNumber: number;
  /** Proposal round within the quest (0-indexed). Bumps when the leader
   *  rotates within the same quest (= a proposal got rejected, new round
   *  starts). Optional for backward compat with files written before this
   *  field existed; treat absent as round 0. */
  roundIndex?: number;
  turnIndex: number;
  speakerIdentity: string;
  speakerDisplayName: string;
  startedAt: string;
  durationSec: number;
  sampleRate: number;
  /** The text actually consumed by downstream prompts (corrected if the
   *  correction step ran and succeeded, otherwise identical to `transcript_raw`). */
  transcript: string;
  /** The raw Azure STT output — preserved for auditing + reproducibility. */
  transcript_raw: string;
  /** True if the LLM correction step ran successfully on this turn. */
  transcript_corrected: boolean;
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
  /** Highest roundIndex seen for this player in lastQuestNumber. Optional
   *  for backward compat with dossier files written before this existed. */
  lastRoundIndex?: number;
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

/** One speaker's contribution to the assassin-phase discussion. */
export interface DiscussionSpeakerRecord {
  identity: string;
  display_name: string;
  durationSec: number;
  sampleRate: number;
  transcript: string;
  transcript_raw: string;
  transcript_corrected: boolean;
  confidence: number | null;
  /** Undefined if summarization was skipped (silent clip) or failed. */
  summary?: TurnSummary;
}

/** Written to discussion.json when the assassin-phase discussion runs. */
export interface DiscussionJson {
  gameId: string;
  startedAt: string;
  durationSec: number;
  assassinIdentity: string | null;
  assassinDisplayName: string | null;
  speakers: DiscussionSpeakerRecord[];
}

/**
 * Written to summary.<lang>.json after the game ends. Each language gets its own
 * file. The shape is discriminated by `mode`: god reveals roles + performance;
 * blind shows the evolving guesses, never the truth.
 */
interface SummaryCommon {
  language: 'fa' | 'en';
  gameId: string;
  roomCode: string;
  generatedAt: string;
  outcome: {
    winner: 'good' | 'evil' | null;
    win_reason: string | null;
    ended_at: string | null;
  };
  /** Per-quest structured data from quest_<n>.json files (order preserved). */
  quests: QuestJson[];
  /** The assassin-phase discussion, if one happened. Null otherwise. */
  discussion: DiscussionJson | null;
}

/** God mode: roles are known → reveal + (later) performance. */
export interface GodSummaryJson extends SummaryCommon {
  mode: 'god';
  /** Roster including the true roles. */
  players: Array<{
    id: string;
    display_name: string;
    seat_number: number | null;
    role: 'good' | 'evil';
    special_role: string | null;
  }>;
  /** Prose "who was who" paragraph(s) in the target language. */
  role_reveal: string;
  /** Main narrative prose in the target language. */
  narrative: string;
}

/** Blind mode: roles never read → evolving guesses + reasoning, no truth reveal. */
export interface BlindSummaryJson extends SummaryCommon {
  mode: 'blind';
  /** Role-free roster. */
  players: Array<{
    id: string;
    display_name: string;
    seat_number: number | null;
  }>;
  /** The incremental memory: guesses after each round of talk. */
  guess_timeline: GuessRound[];
  /** End-state guesses (= the last timeline entry's guesses). */
  final_guesses: RoleGuess[];
  /** Freeform game recap + final guesses in the target language. */
  final_summary: string;
}

export type SummaryJson = GodSummaryJson | BlindSummaryJson;

/** One completed turn before STT has been applied. */
export interface RecordedTurn {
  questNumber: number;
  /** Proposal round within the quest (0-indexed). See TurnJson.roundIndex. */
  roundIndex: number;
  turnIndex: number;
  speakerIdentity: string;
  speakerDisplayName: string;
  startedAt: Date;
  durationSec: number;
  sampleRate: number;
  pcm: Int16Array;
}

// ── Blind-mode role guessing ────────────────────────────────────────────────

/** One role guess for a player at a point in the game (blind mode). */
export interface RoleGuess {
  /** Exact display name from the roster. */
  player: string;
  /** Best-guess Avalon role label, e.g. "Merlin", "Assassin", "Loyal Servant". */
  guessed_role: string;
  confidence: 'low' | 'med' | 'high';
  /** 1–2 sentence base-language (fa) explanation for this round's read. */
  reasoning: string;
}

/** One entry in the incremental guess memory — per completed round of talk. */
export interface GuessRound {
  /** Global discussion-phase index (1-based). */
  round: number;
  quest: number;
  /** Proposal round within the quest (0-based). */
  proposal_round: number;
  guesses: RoleGuess[];
}

/** Written incrementally to guess_log.json during a blind-mode game. */
export interface GuessLog {
  gameId: string;
  updatedAt: string;
  rounds: GuessRound[];
}
