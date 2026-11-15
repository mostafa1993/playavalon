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
/** Split intel as the role route sends it: certain evil, and a mixed pair. */
export interface IntelGroups {
  certainEvil: Array<{ id: string; name: string }>;
  mixedIntel: Array<{ id: string; name: string }>;
  hiddenCount: number;
}

/** Evil-ring visibility: the one teammate this evil player knows. */
export interface EvilRing {
  knownTeammate: { id: string; name: string };
  hiddenCount: number;
}

export interface RoleIntel {
  /** Display names of players the agent can see as "evil" / Merlin candidates / etc. */
  known_players: string[];
  /** UI label describing what known_players represents ("The evil among you", etc.) */
  known_players_label: string;
  /** Merlin with split intel (or Oberon split intel): the two groups. */
  split_intel?: IntelGroups;
  oberon_split_intel?: IntelGroups;
  /** An evil player with evil-ring visibility: the one teammate known. */
  evil_ring?: EvilRing;
  /** Merlin with a decoy in play: the app's warning, as shown to Merlin. */
  decoy_warning?: string;
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
