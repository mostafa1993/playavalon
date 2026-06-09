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
  /** Number of consecutive rejected proposals in the current quest (0-4).
   *  When it would hit 5, evil wins automatically — Brain MUST always
   *  approve when vote_track === 4 (covered in voting.ts). */
  vote_track: number;
  in_intro_phase: boolean;
  /** Required team size for the current quest (and required fails). */
  quest_requirement: { size: number; fails_required: number };
  /** Players list (with is_leader / is_on_team / has_voted flags). Empty
   *  in pre-game / not-yet-started states. */
  players: Array<{
    id: string;
    display_name: string;
    seat_position: number;
    is_leader: boolean;
    is_on_team: boolean;
    has_voted: boolean;
    is_connected: boolean;
  }>;
  /** Active team proposal (null if no proposal yet or not in voting phase). */
  current_proposal: null | {
    id: string;
    leader_id: string;
    team_member_ids: string[];
    proposal_number: number;
  };
  /** This agent's own vote on the current proposal, if cast. */
  my_vote: 'approve' | 'reject' | null;
  am_team_member: boolean;
  has_voted: boolean;
  has_submitted_action: boolean;
  votes_submitted: number;
  actions_submitted: number;
  total_team_members: number;
  /** Lady of the Lake state if the room enabled it. */
  lady_of_lake: null | {
    holder_id: string | null;
    investigated_player_ids: string[];
    is_holder: boolean;
    can_investigate: boolean;
  };
  /** Assassin phase state — only populated during phase === 'assassin'. */
  assassin_phase: null | {
    assassin_id: string;
    merlin_id: string;
    can_guess: boolean;
  };
  /** True iff THIS agent is the assassin (regardless of current phase). */
  is_assassin: boolean;
}

/**
 * Merlin Quiz state — separate fetch on /api/games/[gameId]/merlin-quiz,
 * only relevant after game ends. Cached by Observer when game.phase = game_over.
 */
export interface MerlinQuizObservation {
  enabled: boolean;
  active: boolean;
  complete: boolean;
  has_voted: boolean;
  has_skipped: boolean;
}

export interface Observation {
  /** Always present once the agent has joined the room. */
  room: RoomObservation;
  /** Present only after the game has been created (status === 'started' or game exists). */
  game?: GameObservation;
  /** Merlin quiz state — populated only when game.phase === 'game_over' AND
   *  quiz_enabled is true (i.e., Merlin was in the game). */
  merlin_quiz?: MerlinQuizObservation;
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
