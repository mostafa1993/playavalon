/**
 * Identity — everything the agent knows about itself once it's signed in
 * and joined a room. Built up by the engine; consumed by the Brain.
 */

export type Role = 'good' | 'evil';

export type SpecialRole =
  | 'merlin'
  | 'percival'
  | 'servant'
  | 'assassin'
  | 'morgana'
  | 'mordred'
  | 'oberon_standard'
  | 'oberon_chaos'
  | 'minion'
  | 'lunatic'
  | 'brute';

/**
 * Role-specific intel given to the agent at game start. Mirrors the
 * meaningful subset of GET /api/rooms/[code]/role. Populated after the
 * Observer fetches the role endpoint (once per game, then cached).
 *
 * Filled with structurally-empty defaults for roles whose intel is N/A
 * (e.g., plain servant sees nothing). Brain modules should treat empty
 * arrays as "no intel" not "no players exist."
 */
export interface RoleIntel {
  /** Display names of players the agent can see as "evil" / Merlin candidates / etc. */
  known_players: string[];
  /** UI label describing what known_players represents ("The evil among you", etc.) */
  known_players_label: string;
  /** If the agent is Merlin and split-intel is enabled, the two groups. */
  split_intel?: unknown;
  oberon_split_intel?: unknown;
  /** Number of evil players hidden from Merlin (Mordred/Oberon chaos). */
  hidden_evil_count?: number;
  /** Whether the agent currently holds the Lady of the Lake token. */
  has_lady_of_lake?: boolean;
}

export interface Identity {
  user_id: string;          // Supabase auth UID == players.id
  username: string;         // 'bot_alice'
  display_name: string;     // 'Alice'
  role: Role;
  special_role: SpecialRole;
  role_intel: RoleIntel;
}
