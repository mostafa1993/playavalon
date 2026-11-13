/**
 * Shared types for the reviewer agent.
 */

// SpeakingTimerState + RecordedTurn moved to @avalon/shared (the bot players
// use the same speaking-timer machinery); re-exported for reviewer-local use.
export type { SpeakingTimerState, RecordedTurn } from '@avalon/shared';

import type { RolesInPlay } from './gamestate/roleConfig.js';
import type { GameOutcome } from './gamestate/db.js';

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
  /** Public game setup (good/evil counts + special roles enabled). Safe for
   *  blind mode — it's the configuration, never per-player assignments. Null
   *  if the player count is outside the supported range. */
  rolesInPlay?: RolesInPlay | null;
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
  rolesInPlay?: GameMetaSnapshot['rolesInPlay'];
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

/** A turn as speech-to-text leaves it: what every later step starts from,
 *  and all of a turn a replay copies in. */
export interface RawTurnJson {
  gameId: string;
  questNumber: number;
  /** Proposal round within the quest (0-indexed). Bumps when the leader
   *  rotates within the same quest (= a proposal got rejected, new round
   *  starts). */
  roundIndex: number;
  turnIndex: number;
  speakerIdentity: string;
  speakerDisplayName: string;
  startedAt: string;
  durationSec: number;
  sampleRate: number;
  /** The raw Azure STT output — preserved for auditing + reproducibility. */
  transcript_raw: string;
  confidence: number | null;
  language: string;
}

/** Written to turn_<q>_<r>_<i>.json after STT + summarizer complete. */
export interface TurnJson extends RawTurnJson {
  /** The text actually consumed by downstream prompts (corrected if the
   *  correction step ran and succeeded, otherwise identical to `transcript_raw`). */
  transcript: string;
  /** True if the LLM correction step ran successfully on this turn. */
  transcript_corrected: boolean;
  /** Undefined if summarization was skipped or failed. */
  summary?: TurnSummary;
}

/** Evolving per-player memory, written to dossier_<playerId>.json. */
export interface DossierJson {
  playerId: string;
  playerDisplayName: string;
  lastQuestNumber: number;
  /** Highest roundIndex seen for this player in lastQuestNumber. */
  lastRoundIndex: number;
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

/** One speaker's clip from the assassin-phase discussion as speech-to-text
 *  left it (an empty transcript when the clip was silent or STT failed). */
export interface RawDiscussionSpeaker {
  identity: string;
  display_name: string;
  durationSec: number;
  sampleRate: number;
  transcript_raw: string;
  confidence: number | null;
}

/** One speaker's contribution to the assassin-phase discussion. */
export interface DiscussionSpeakerRecord extends RawDiscussionSpeaker {
  transcript: string;
  transcript_corrected: boolean;
  /** Undefined if summarization was skipped (silent clip) or failed. */
  summary?: TurnSummary;
}

/** The assassin-phase discussion as recorded and transcribed, before any
 *  model step: what a replay copies in. */
export interface RawDiscussionJson {
  gameId: string;
  startedAt: string;
  durationSec: number;
  assassinIdentity: string | null;
  speakers: RawDiscussionSpeaker[];
}

/** Written to discussion.json when the assassin-phase discussion runs. */
export interface DiscussionJson extends Omit<RawDiscussionJson, 'speakers'> {
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
  /** Per-player performance assessment (role known). */
  performance: PlayerPerformance[];
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

// ── The game record ─────────────────────────────────────────────────────────

/** One seat at the table. Seat 1 is the first leader, then clockwise. */
export interface RecordPlayer {
  id: string;
  display_name: string;
  seat_number: number;
}

/** God mode only: the seat with its true role. */
export interface GodRecordPlayer extends RecordPlayer {
  role: 'good' | 'evil';
  special_role: string | null;
}

export interface RecordVote {
  playerId: string;
  vote: 'approve' | 'reject';
}

export interface RecordProposal {
  quest: number;
  proposalNumber: number;
  leaderId: string;
  teamIds: string[];
  status: 'pending' | 'approved' | 'rejected';
  /** In seat order; empty while the proposal is pending (votes not revealed). */
  votes: RecordVote[];
  createdAt: string;
  /** When the vote closed; null while pending. */
  resolvedAt: string | null;
}

/** A mission as `games.quest_results` holds it. Never who played a fail card. */
export interface RecordMission {
  quest: number;
  teamIds: string[];
  successCount: number;
  failCount: number;
  result: 'success' | 'fail';
  completedAt: string;
}

/** Lady of the Lake, used after `quest`'s mission: who looked at whom. */
export interface RecordLadyUse {
  quest: number;
  investigatorId: string;
  targetId: string;
}

/** God mode only: the Lady result, which only the investigator saw. */
export interface GodRecordLadyUse extends RecordLadyUse {
  result: 'good' | 'evil';
}

/** One speaking turn, from its turn file. */
export interface RecordTurn {
  /** 0 is the intro round. */
  quest: number;
  round: number;
  turn: number;
  speakerId: string;
  transcript: string;
  confidence: number | null;
  startedAt: string;
  durationSec: number;
  /** The proposal of `quest` this talk was about: the first one whose vote
   *  closed after the turn started, else the quest's latest. Null in the intro
   *  round or a quest with no proposal. */
  proposalNumber: number | null;
}

/** One speaker's clip from the assassin-phase discussion. */
export interface RecordDiscussionSpeaker {
  speakerId: string;
  transcript: string;
  confidence: number | null;
  durationSec: number;
}

export interface RecordDiscussion {
  startedAt: string;
  durationSec: number;
  speakers: RecordDiscussionSpeaker[];
}

interface GameRecordCommon {
  gameId: string;
  /** Set on the record so far: everything public once this quest's round of
   *  talk ended. Null on the whole game's record. */
  cut: { quest: number; round: number } | null;
  /** Ordered by quest, then proposal number. */
  proposals: RecordProposal[];
  missions: RecordMission[];
  /** Who the assassin named as Merlin; null without an assassin pick. */
  assassinPickId: string | null;
  /** Null on a cut. */
  outcome: GameOutcome | null;
  /** Ordered by quest, round, turn. */
  turns: RecordTurn[];
  /** The assassin-phase discussion; null when there was none, and on a cut. */
  discussion: RecordDiscussion | null;
}

/** God mode: public play plus the roles and Lady results. */
export interface GodGameRecord extends GameRecordCommon {
  mode: 'god';
  players: GodRecordPlayer[];
  lady: GodRecordLadyUse[];
}

/** Blind mode: public play only — no role, no Lady result. */
export interface BlindGameRecord extends GameRecordCommon {
  mode: 'blind';
  players: RecordPlayer[];
  lady: RecordLadyUse[];
}

/** Written to record.json: every fact of the game, built in code. */
export type GameRecord = GodGameRecord | BlindGameRecord;

/** God-mode per-player performance assessment. */
export interface PlayerPerformance {
  /** Exact display name. */
  player: string;
  /** The player's true role. */
  role: string;
  /** 2–4 sentence assessment in the target language. */
  assessment: string;
}
