/**
 * Application constants
 * Centralized configuration values
 * Updated for Phase 2: Special Roles & Configurations
 */

import type { RoleRatios, SpecialRole } from '@/types/role';

/**
 * Player count limits
 */
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

/**
 * Room code configuration
 */
export const ROOM_CODE_LENGTH = 6;

/**
 * Timing constants (in milliseconds)
 */
export const RECONNECTION_GRACE_PERIOD = 5 * 60 * 1000; // 5 minutes
export const WAITING_ROOM_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
export const STARTED_ROOM_TIMEOUT = 48 * 60 * 60 * 1000; // 48 hours
export const REALTIME_UPDATE_DELAY = 2000; // 2 seconds max

/**
 * Lady of the Lake recommended player count
 */
export const LADY_OF_LAKE_MIN_RECOMMENDED = 7;

/**
 * Role distribution ratios by player count
 * Standard Avalon ratios:
 * 5p = 3G/2E, 6p = 4G/2E, 7p = 4G/3E, 8p = 5G/3E, 9p = 6G/3E, 10p = 6G/4E
 */
export const ROLE_RATIOS: RoleRatios = {
  5: { good: 3, evil: 2 },
  6: { good: 4, evil: 2 },
  7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 },
  9: { good: 6, evil: 3 },
  10: { good: 6, evil: 4 },
};

/**
 * Special role metadata
 */
export interface SpecialRoleInfo {
  name: string;
  team: 'good' | 'evil';
  description: string;
  emoji: string;
  // Visibility rules
  knowsEvil: boolean;        // Can see evil players (Merlin)
  knownToMerlin: boolean;    // Visible to Merlin (not Mordred, not Oberon Chaos)
  knowsMerlin: boolean;      // Can see Merlin candidates (Percival)
  appearsAsMerlin: boolean;  // Appears as Merlin to Percival (Morgana)
  knowsTeammates: boolean;   // Can see evil teammates (not Oberon)
  // Constraints
  required: boolean;         // Always included (Merlin, Assassin)
  maxPerGame: number;        // Max instances (always 1 for special roles)
}

export const SPECIAL_ROLES: Record<SpecialRole, SpecialRoleInfo> = {
  merlin: {
    name: 'Merlin',
    team: 'good',
    description: 'Knows evil players (except Mordred and Oberon Chaos)',
    emoji: '🧙',
    knowsEvil: true,
    knownToMerlin: false,
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: false,
    required: true,
    maxPerGame: 1,
  },
  percival: {
    name: 'Percival',
    team: 'good',
    description: 'Knows Merlin (but Morgana appears the same)',
    emoji: '🛡️',
    knowsEvil: false,
    knownToMerlin: false,
    knowsMerlin: true,
    appearsAsMerlin: false,
    knowsTeammates: false,
    required: false,
    maxPerGame: 1,
  },
  servant: {
    name: 'Loyal Servant',
    team: 'good',
    description: 'Basic good team member',
    emoji: '⚔️',
    knowsEvil: false,
    knownToMerlin: false,
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: false,
    required: false,
    maxPerGame: 10,
  },
  assassin: {
    name: 'Assassin',
    team: 'evil',
    description: 'Can assassinate Merlin at end of game',
    emoji: '🗡️',
    knowsEvil: false,
    knownToMerlin: true,
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: true,
    required: true,
    maxPerGame: 1,
  },
  morgana: {
    name: 'Morgana',
    team: 'evil',
    description: 'Appears as Merlin to Percival',
    emoji: '🧙‍♀️',
    knowsEvil: false,
    knownToMerlin: true,
    knowsMerlin: false,
    appearsAsMerlin: true,
    knowsTeammates: true,
    required: false,
    maxPerGame: 1,
  },
  mordred: {
    name: 'Mordred',
    team: 'evil',
    description: 'Hidden from Merlin',
    emoji: '🐍',
    knowsEvil: false,
    knownToMerlin: false,  // KEY: Hidden from Merlin
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: true,
    required: false,
    maxPerGame: 1,
  },
  oberon_standard: {
    name: 'Oberon',
    team: 'evil',
    description: 'Works alone, visible to Merlin, hidden from evil team',
    emoji: '👤',
    knowsEvil: false,
    knownToMerlin: true,   // Merlin CAN see Oberon Standard
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: false, // KEY: Doesn't know evil teammates
    required: false,
    maxPerGame: 1,
  },
  oberon_chaos: {
    name: 'Oberon (Chaos)',
    team: 'evil',
    description: 'Completely hidden, even from Merlin!',
    emoji: '👻',
    knowsEvil: false,
    knownToMerlin: false,  // KEY: Hidden even from Merlin!
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: false, // Doesn't know evil teammates
    required: false,
    maxPerGame: 1,
  },
  minion: {
    name: 'Minion',
    team: 'evil',
    description: 'Basic evil team member',
    emoji: '😈',
    knowsEvil: false,
    knownToMerlin: true,
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: true,
    required: false,
    maxPerGame: 10,
  },
  // Feature 020: Big Box Expansion Roles
  lunatic: {
    name: 'Lunatic',
    team: 'evil',
    description: 'Must play Fail on every quest',
    emoji: '🤪',
    knowsEvil: false,
    knownToMerlin: true,      // Visible to Merlin
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: true,     // Knows evil teammates
    required: false,
    maxPerGame: 1,
  },
  brute: {
    name: 'Brute',
    team: 'evil',
    description: 'Can only Fail on Quests 1-3',
    emoji: '👊',
    knowsEvil: false,
    knownToMerlin: true,      // Visible to Merlin
    knowsMerlin: false,
    appearsAsMerlin: false,
    knowsTeammates: true,     // Knows evil teammates
    required: false,
    maxPerGame: 1,
  },
};

/**
 * Good team special roles (for UI grouping)
 */
export const GOOD_SPECIAL_ROLES: SpecialRole[] = ['merlin', 'percival', 'servant'];

/**
 * Evil team special roles (for UI grouping)
 */
export const EVIL_SPECIAL_ROLES: SpecialRole[] = ['assassin', 'morgana', 'mordred', 'oberon_standard', 'oberon_chaos', 'minion', 'lunatic', 'brute'];

/**
 * Optional good roles that can be configured
 */
export const OPTIONAL_GOOD_ROLES: SpecialRole[] = ['percival'];

/**
 * Optional evil roles that can be configured
 */
export const OPTIONAL_EVIL_ROLES: SpecialRole[] = ['morgana', 'mordred', 'oberon_standard', 'oberon_chaos', 'lunatic', 'brute'];

/**
 * Get role distribution for a player count
 * @param playerCount - Number of players (5-10)
 * @returns Role distribution or null if invalid count
 */
export function getRoleRatio(playerCount: number) {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    return null;
  }
  return ROLE_RATIOS[playerCount];
}

/**
 * API Error codes
 */
export const ERROR_CODES = {
  // General
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Player errors
  INVALID_PLAYER_ID: 'INVALID_PLAYER_ID',
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  PLAYER_ALREADY_IN_ROOM: 'PLAYER_ALREADY_IN_ROOM',

  // Room errors
  INVALID_PLAYER_COUNT: 'INVALID_PLAYER_COUNT',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_NOT_WAITING: 'ROOM_NOT_WAITING',
  NOT_ROOM_MEMBER: 'NOT_ROOM_MEMBER',
  NOT_ROOM_MANAGER: 'NOT_ROOM_MANAGER',

  // Role errors
  ROOM_NOT_FULL: 'ROOM_NOT_FULL',
  ROLES_ALREADY_DISTRIBUTED: 'ROLES_ALREADY_DISTRIBUTED',
  ROLES_NOT_DISTRIBUTED: 'ROLES_NOT_DISTRIBUTED',
  ALREADY_CONFIRMED: 'ALREADY_CONFIRMED',

  // Game errors
  NOT_ALL_CONFIRMED: 'NOT_ALL_CONFIRMED',
  ALREADY_STARTED: 'ALREADY_STARTED',

  // Feature 020: Lunatic/Brute quest action errors
  LUNATIC_MUST_FAIL: 'LUNATIC_MUST_FAIL',
  BRUTE_CANNOT_FAIL_LATE_QUEST: 'BRUTE_CANNOT_FAIL_LATE_QUEST',

  // Feature 022: AI Game Reviewer
  AI_CONSENT_REQUIRED: 'AI_CONSENT_REQUIRED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
