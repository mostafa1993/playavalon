/**
 * Role-related types for application use
 * Updated for Phase 2: Special Roles & Configurations
 */

import type { Role, SpecialRole } from './database';
import type { RoleConfig } from './role-config';

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
 * Role display info (extended for Phase 2)
 */
export interface RoleInfo {
  role: Role;
  special_role: SpecialRole;
  role_name: string;
  role_description: string;
  is_confirmed: boolean;
  has_lady_of_lake?: boolean;
  // Visibility data (character-specific)
  evil_teammates?: string[];
  known_players?: Array<{ id: string; display_name: string }>;
  known_players_label?: string;
  hidden_evil_count?: number;
  ability_note?: string;
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
 * Special role display names
 */
export const SPECIAL_ROLE_NAMES: Record<SpecialRole, string> = {
  merlin: 'Merlin',
  percival: 'Percival',
  servant: 'Loyal Servant of Arthur',
  assassin: 'The Assassin',
  morgana: 'Morgana',
  mordred: 'Mordred',
  oberon_standard: 'Oberon',
  oberon_chaos: 'Oberon (Chaos)',
  minion: 'Minion of Mordred',
  lunatic: 'Lunatic',
  brute: 'Brute',
};

/**
 * Special role descriptions
 */
export const SPECIAL_ROLE_DESCRIPTIONS: Record<SpecialRole, string> = {
  merlin: 'You are Merlin, the wise wizard. You know the identities of the evil players (except Mordred and Oberon Chaos). Guide your team to victory, but beware - if the Assassin discovers you, all is lost!',
  percival: 'You are Percival, the loyal knight. You know who Merlin is (but Morgana may appear as Merlin too). Protect Merlin at all costs!',
  servant: 'You are a loyal servant of King Arthur. Work with your fellow knights to complete quests and identify the traitors among you.',
  assassin: 'You are the Assassin, deadliest of Mordred\'s minions. If the good team wins, you have one chance to assassinate Merlin and steal victory!',
  morgana: 'You are Morgana, the dark enchantress. You appear as Merlin to Percival. Use this to sow confusion and protect the real evil team!',
  mordred: 'You are Mordred, the dark lord himself. Even Merlin cannot see your evil nature. Lead your minions to victory from the shadows!',
  oberon_standard: 'You are Oberon, the mysterious evil. You do not know the other evil players, and they do not know you. Merlin can see you. Work alone to sabotage the quests!',
  oberon_chaos: 'You are Oberon in Chaos mode! No one knows you are evil - not even Merlin! You work completely alone.',
  minion: 'You serve the dark lord Mordred. Sabotage the quests and avoid detection. You know who your fellow minions are.',
  lunatic: 'You are the Lunatic, a servant of Mordred driven by madness. You MUST play Fail on every quest you join—you have no choice.',
  brute: 'You are the Brute, a servant of Mordred who has some tricks, but not many. You can only play Fail on Quests 1, 2, and 3. On Quests 4 and 5, you MUST play Success. Use your early sabotage wisely!',
};

/**
 * Base role display names (for backward compatibility)
 */
export const ROLE_NAMES: Record<Role, string> = {
  good: 'Loyal Servant of Arthur',
  evil: 'Minion of Mordred',
};

/**
 * Base role descriptions (for backward compatibility)
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  good: 'You serve King Arthur and seek to complete quests for the good of Camelot. You do not know who the Minions of Mordred are.',
  evil: 'You serve Mordred and seek to sabotage the quests of Camelot. You know who your fellow Minions are.',
};

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
