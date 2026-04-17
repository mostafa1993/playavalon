/**
 * Watcher Mode Types
 * Feature 015: Spectator mode for non-players to observe games
 *
 * CRITICAL: All watcher data is ephemeral (in-memory only).
 * No database schema changes - per NFR-004 (no FK to game tables).
 */

import type {
  Game,
  TeamProposal,
  QuestRequirement,
  LastVoteResult,
} from './game';

// ============================================
// CONSTANTS
// ============================================

/** Maximum watchers per game (FR-004) */
export const MAX_WATCHERS_PER_GAME = 10;

/** Timeout for stale watcher cleanup (seconds) */
export const WATCHER_TIMEOUT_SECONDS = 30;

/** Polling interval matches players (milliseconds) */
export const WATCHER_POLL_INTERVAL_MS = 3000;

// ============================================
// WATCHER SESSION TYPES
// ============================================

/**
 * Information about a single watcher
 * Stored in memory only - NOT persisted to database
 */
export interface WatcherInfo {
  /** Watcher's display name */
  display_name: string;

  /** Auth user ID */
  userId: string;

  /** Unix timestamp when watcher joined */
  joinedAt: number;

  /** Unix timestamp of last activity (for timeout detection) */
  lastSeen: number;
}

/**
 * In-memory storage type for watcher sessions
 * Key: gameId, Value: Map of playerId -> WatcherInfo
 */
export type WatcherSessionStore = Map<string, Map<string, WatcherInfo>>;

// ============================================
// WATCHER GAME STATE TYPES
// ============================================

/**
 * Player info for watcher view - NO role information
 * This is a subset of GamePlayer that hides sensitive data
 */
export interface WatcherPlayerInfo {
  id: string;
  display_name: string;
  seat_position: number;
  is_leader: boolean;
  is_on_team: boolean;
  has_voted: boolean;
  is_connected: boolean;
  // Roles only revealed at game_over phase
  revealed_role?: 'good' | 'evil';
  revealed_special_role?: string;
  // NO was_decoy - watchers don't see this
  // NO was_mixed_group - watchers don't see this
}

/**
 * Lady of the Lake state for watchers
 * Shows WHO was investigated but NOT the result
 */
export interface WatcherLadyState {
  enabled: boolean;
  holder_display_name: string | null;
  /** Public announcement of investigation (no result) */
  last_investigation: {
    investigator_display_name: string;
    target_display_name: string;
    // NO result field - watchers don't see this
  } | null;
}

/**
 * Game state as seen by a watcher
 * This is a SUBSET of GameState - excludes all player-specific fields
 */
export interface WatcherGameState {
  /** Core game data (same as player view) */
  game: Game;

  /** Player info WITHOUT role data (until game_over) */
  players: WatcherPlayerInfo[];

  /** Current proposal (if any) */
  current_proposal: TeamProposal | null;

  /** Quest requirements for current quest */
  quest_requirement: QuestRequirement;

  /** Aggregate vote count (not individual votes until reveal) */
  votes_submitted: number;
  total_players: number;

  /** Quest action count (not individual actions) */
  actions_submitted: number;
  total_team_members: number;

  /** Vote results ONLY after reveal (same timing as players) */
  last_vote_result: LastVoteResult | null;

  /** Lady of the Lake state (public info only) */
  lady_of_lake: WatcherLadyState | null;

  /** Draft team (visible to all) */
  draft_team: string[] | null;
}

// ============================================
// API RESPONSE TYPES
// ============================================

/**
 * Error codes for watcher API responses
 */
export type WatcherErrorCode =
  | 'GAME_NOT_STARTED'
  | 'WATCHER_LIMIT_REACHED'
  | 'GAME_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'NOT_WATCHER'
  | 'SESSION_EXPIRED'
  | 'GAME_ENDED'
  | 'ROOM_NOT_FOUND';

/**
 * Error structure for watcher API responses
 */
export interface WatcherError {
  code: WatcherErrorCode;
  message: string;
}

/**
 * Response for POST /api/watch/[gameId]/join
 */
export interface JoinWatchResponse {
  success: boolean;
  gameId: string;
  watcherCount: number;
}

/**
 * Response for POST /api/watch/[gameId]/leave
 */
export interface LeaveWatchResponse {
  success: boolean;
  watcherCount: number;
}

/**
 * Response for GET /api/rooms/[code]/watch-status
 */
export interface WatchStatusResponse {
  watchable: boolean;
  gameId?: string;
  watcherCount?: number;
  watcherLimit?: number;
  reason?: 'GAME_NOT_STARTED' | 'GAME_ENDED' | 'ROOM_NOT_FOUND' | 'GAME_NOT_FOUND';
}

// ============================================
// HOOK TYPES
// ============================================

/**
 * Result type for useWatcherState hook
 */
export interface UseWatcherStateResult {
  gameState: WatcherGameState | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}
