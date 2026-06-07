/**
 * Observation — the structured snapshot the Brain reads on every tick.
 *
 * Combines:
 *   - Room state from GET /api/rooms/[code]    (pre-game lobby + AI consent flags)
 *   - Game state from GET /api/games/[gameId] (when game.has_game is true)
 *
 * Phase 0 only needs the pre-game half. The post-game shape is sketched so
 * the type is stable from day one; later phases populate the rest.
 */

import type { Role, SpecialRole } from './Identity.js';

export type RoomStatus = 'waiting' | 'roles_distributed' | 'started' | 'closed';

export type GamePhase =
  | 'team_building'
  | 'voting'
  | 'quest'
  | 'quest_result'
  | 'lady_of_lake'
  | 'assassin'
  | 'game_over';

export interface PlayerObservation {
  id: string;
  display_name: string;
  is_manager: boolean;
  is_leader?: boolean;
  is_connected: boolean;
}

export interface RoomObservation {
  code: string;
  status: RoomStatus;
  expected_players: number;
  manager_id: string;
  /** True if the room creator opted into AI review (we may need to consent). */
  ai_review_enabled: boolean;
  /** True if THIS agent has already accepted AI consent (if needed). */
  ai_consent_given: boolean;
  /** True if THIS agent's role is confirmed (pre-game only). */
  is_confirmed: boolean;
  players: PlayerObservation[];
  /** True once the room transitions to roles_distributed. */
  roles_distributed: boolean;
}

export interface GameObservation {
  game_id: string;
  phase: GamePhase;
  current_quest: number;
  current_leader_id: string;
  vote_track: number;
  in_intro_phase: boolean;
  // populated in later phases — kept on the type so Brain modules can compile
  // against it from day one
  am_team_member?: boolean;
  has_voted?: boolean;
  has_submitted_action?: boolean;
}

export interface Observation {
  /** Always present once the agent has joined the room. */
  room: RoomObservation;
  /** Present only after the game has been created (status === 'started' or game exists). */
  game?: GameObservation;
  /** Convenience snapshots so Brain doesn't need to look up its own row. */
  self: {
    role?: Role;
    special_role?: SpecialRole;
    is_in_room: boolean;
    is_leader: boolean;
  };
  /** Monotonic counter of how many times Observer has fetched. Useful for debug logging. */
  tick: number;
  /** When this snapshot was taken. */
  fetched_at: Date;
}
