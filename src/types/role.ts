/**
 * Role-related types for application use
 * Updated for Phase 2: Special Roles & Configurations
 */

import type { Role, SpecialRole } from './database';
import type { SplitIntelVisibility, OberonSplitIntelVisibility, EvilRingVisibility } from './game';

// Re-export for convenience
export type { Role, SpecialRole } from './database';
export type { RoleConfig, OberonMode } from './role-config';

/**
 * Role distribution ratios based on player count
 * Standard Avalon ratios:
 * 5p = 3G/2E, 6p = 4G/2E, 7p = 4G/3E, 8p = 5G/3E, 9p = 6G/3E, 10p = 6G/4E
 */
export interface RoleDistribution {
  good: number;
  evil: number;
}

/**
 * Role ratios by player count
 */
export type RoleRatios = Record<number, RoleDistribution>;

/**
 * A player's role and everything they know (GET /api/rooms/[code]/role).
 * Shown at role distribution and from the in-game Role button.
 */
export interface RoleDetails {
  role: Role;
  special_role?: SpecialRole;
  role_name: string;
  role_description: string;
  /** Whether the game has a Merlin (the room's setup) */
  merlin_in_play: boolean;
  is_confirmed: boolean;
  has_lady_of_lake?: boolean;
  // Visibility data (character-specific)
  known_players?: string[];
  known_players_label?: string;
  hidden_evil_count?: number;
  has_decoy?: boolean;
  decoy_warning?: string;
  split_intel?: SplitIntelVisibility;
  oberon_split_intel?: OberonSplitIntelVisibility;
  evil_ring_visibility?: EvilRingVisibility;
}

/**
 * Role assignment for a player (extended for Phase 2)
 */
export interface PlayerRoleAssignment {
  player_id: string;
  role: Role;
  special_role: SpecialRole;
  has_lady_of_lake?: boolean;
}

/**
 * Role distribution result (extended for Phase 2)
 */
export interface DistributeRolesResponse {
  distributed: true;
  player_count: number;
  good_count: number;
  evil_count: number;
  roles_in_play: string[];
  lady_of_lake_holder_id?: string | null;
}

/**
 * Role confirmation response
 */
export interface ConfirmRoleResponse {
  confirmed: true;
  confirmations: {
    total: number;
    confirmed: number;
  };
  all_confirmed: boolean;
}

/**
 * Check if a special role is on the good team
 */
export function isGoodRole(specialRole: SpecialRole): boolean {
  return specialRole === 'merlin' || specialRole === 'percival' || specialRole === 'servant';
}

/**
 * Check if a special role is a Big Box expansion role
 */
export function isBigBoxRole(specialRole: SpecialRole): boolean {
  return specialRole === 'lunatic' || specialRole === 'brute';
}

/**
 * Check if a special role is on the evil team
 */
export function isEvilRole(specialRole: SpecialRole): boolean {
  return !isGoodRole(specialRole);
}

/**
 * Get the base alignment for a special role
 */
export function getRoleAlignment(specialRole: SpecialRole): Role {
  return isGoodRole(specialRole) ? 'good' : 'evil';
}
