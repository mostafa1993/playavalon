/**
 * Role Configuration Domain Logic
 * Pure functions for validating and computing role configurations
 */

import { ROLE_RATIOS, SPECIAL_ROLES, LADY_OF_LAKE_MIN_RECOMMENDED } from '@/lib/utils/constants';
import { isValidRoleConfig } from '@/types/role-config';
import type { RoleConfig, RoleConfigValidation } from '@/types/role-config';
import type { SpecialRole } from '@/types/database';
import { canEnableEvilRingVisibility } from './evil-ring-visibility';

/**
 * T009: Get default role configuration
 * Merlin and the Assassin, no other special roles
 */
export function getDefaultConfig(): RoleConfig {
  return { merlin: true };
}

/**
 * Setup options that need Merlin in the game, each refused while Merlin is off
 * with a message naming both.
 */
const NEEDS_MERLIN: { isOn: (config: RoleConfig) => boolean; error: string }[] = [
  {
    isOn: (c) => !!c.percival,
    error: 'Percival requires Merlin (Percival knows who Merlin is).',
  },
  {
    isOn: (c) => !!c.morgana,
    error: "Morgana requires Merlin (Morgana's only power is to appear as Merlin to Percival).",
  },
  {
    isOn: (c) => !!c.mordred,
    error: "Mordred requires Merlin (Mordred's only power is being hidden from Merlin).",
  },
  {
    isOn: (c) => c.oberon === 'chaos',
    error: 'Oberon (Chaos) requires Merlin (Oberon (Chaos) differs from Oberon (Standard) only in being hidden from Merlin).',
  },
  {
    isOn: (c) => !!c.merlin_decoy_enabled,
    error: 'Merlin Decoy Mode requires Merlin.',
  },
  {
    isOn: (c) => !!c.merlin_split_intel_enabled,
    error: 'Split Intel Mode requires Merlin.',
  },
  {
    isOn: (c) => !!c.oberon_split_intel_enabled,
    error: 'Oberon Split Intel Mode requires Merlin.',
  },
];

/**
 * T007: Validate role configuration against player count
 * Returns validation result with errors and warnings
 */
export function validateRoleConfig(
  config: RoleConfig,
  playerCount: number
): RoleConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // A setup must state whether Merlin is in the game, and every option must have its type
  if (!isValidRoleConfig(config)) {
    errors.push('Invalid role setup: merlin must be true or false, and each option must have a valid value.');
    return { valid: false, errors, warnings };
  }

  // Validate player count
  if (playerCount < 5 || playerCount > 10) {
    errors.push(`Invalid player count: ${playerCount}. Must be between 5 and 10.`);
    return { valid: false, errors, warnings };
  }

  const ratio = ROLE_RATIOS[playerCount];
  if (!ratio) {
    errors.push(`No role ratio defined for ${playerCount} players.`);
    return { valid: false, errors, warnings };
  }

  // Without Merlin, the options that need him are refused
  if (!config.merlin) {
    for (const option of NEEDS_MERLIN) {
      if (option.isOn(config)) errors.push(option.error);
    }
  }

  // Feature 011 + 018: Check triple mutual exclusivity of Merlin intel modes
  const intelModes = [
    config.merlin_decoy_enabled,
    config.merlin_split_intel_enabled,
    config.oberon_split_intel_enabled,
  ].filter(Boolean).length;

  if (intelModes > 1) {
    errors.push('Only one intel mode can be active: Merlin Decoy, Split Intel, or Oberon Split Intel. Choose one.');
  }

  // Feature 018: Check Oberon Split Intel prerequisites
  if (config.oberon_split_intel_enabled) {
    if (!config.oberon) {
      errors.push('Oberon Split Intel Mode requires Oberon (Standard) to be enabled.');
    } else if (config.oberon === 'chaos') {
      errors.push('Oberon Split Intel Mode is not available with Oberon (Chaos) - Oberon must be visible to Merlin.');
    }
  }

  // Feature 019: Check Evil Ring Visibility prerequisites (3+ non-Oberon evil)
  if (config.evil_ring_visibility_enabled) {
    const ringPrereq = canEnableEvilRingVisibility(playerCount, config.oberon);
    if (!ringPrereq.canEnable) {
      errors.push(ringPrereq.reason || 'Evil Ring Visibility requires 3+ non-Oberon evil players.');
    }
  }

  // Feature 020: Check Lunatic/Brute 7+ player requirement
  if ((config.lunatic || config.brute) && playerCount < 7) {
    errors.push('Lunatic and Brute require 7+ players (need 3+ evil slots).');
  }

  // Validate team slots against the special roles dealt
  const specials = countSpecialRoles(config);

  const goodSlotsNeeded = specials.good;
  if (goodSlotsNeeded > ratio.good) {
    errors.push(
      `Too many Good special roles (${goodSlotsNeeded}) for ${playerCount}-player game (max ${ratio.good} Good).`
    );
  }

  const evilSlotsNeeded = specials.evil;
  if (evilSlotsNeeded > ratio.evil) {
    errors.push(
      `Too many Evil special roles (${evilSlotsNeeded}) for ${playerCount}-player game (max ${ratio.evil} Evil).`
    );
  }

  // Add balance warnings (non-blocking)
  if (config.percival && !config.morgana) {
    warnings.push('Percival works best with Morgana for balance.');
  }

  if (config.morgana && !config.percival) {
    warnings.push("Morgana's disguise ability has no effect without Percival.");
  }

  // Lady of Lake warning for small games
  if (config.ladyOfLake && playerCount < LADY_OF_LAKE_MIN_RECOMMENDED) {
    warnings.push(
      `Lady of the Lake is recommended for ${LADY_OF_LAKE_MIN_RECOMMENDED}+ players.`
    );
  }

  // Multiple hidden evil warning for Merlin
  const hiddenFromMerlin = (config.mordred ? 1 : 0) + (config.oberon === 'chaos' ? 1 : 0);
  if (hiddenFromMerlin >= 2) {
    warnings.push('Multiple evil players hidden from Merlin may make the game very difficult for Good.');
  }

  // Feature 011: Warning for Split Intel Mode with hidden evil configuration
  if (config.merlin_split_intel_enabled && hiddenFromMerlin >= 2) {
    warnings.push('Split Intel Mode with multiple hidden evil players means fewer players in Certain Evil group.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Count the special roles a setup deals on each team.
 * Merlin brings the Assassin; without Merlin neither is dealt.
 */
function countSpecialRoles(config: RoleConfig): { good: number; evil: number } {
  const merlin = config.merlin ? 1 : 0;
  return {
    good: merlin + (config.percival ? 1 : 0),
    evil:
      merlin + // the Assassin
      (config.morgana ? 1 : 0) +
      (config.mordred ? 1 : 0) +
      (config.oberon ? 1 : 0) +
      // Feature 020: Big Box roles
      (config.lunatic ? 1 : 0) +
      (config.brute ? 1 : 0),
  };
}

/**
 * T010: Compute human-readable list of roles in play
 * Returns display names for UI
 */
export function computeRolesInPlay(config: RoleConfig): string[] {
  const roles: string[] = [];

  // Good team
  if (config.merlin) roles.push('Merlin');
  if (config.percival) roles.push('Percival');

  // Evil team (the Assassin comes with Merlin)
  if (config.merlin) roles.push('Assassin');
  if (config.morgana) roles.push('Morgana');
  if (config.mordred) roles.push('Mordred');
  if (config.oberon === 'standard') roles.push('Oberon');
  if (config.oberon === 'chaos') roles.push('Oberon (Chaos)');
  // Feature 020: Big Box roles
  if (config.lunatic) roles.push('Lunatic');
  if (config.brute) roles.push('Brute');

  return roles;
}

/**
 * Compute detailed role counts for a configuration
 */
export function getRoleDetails(
  config: RoleConfig,
  playerCount: number
): {
  goodCount: number;
  evilCount: number;
  goodSpecialCount: number;
  evilSpecialCount: number;
  servantCount: number;
  minionCount: number;
} {
  const ratio = ROLE_RATIOS[playerCount];
  if (!ratio) {
    throw new Error(`Invalid player count: ${playerCount}`);
  }

  const specials = countSpecialRoles(config);

  return {
    goodCount: ratio.good,
    evilCount: ratio.evil,
    goodSpecialCount: specials.good,
    evilSpecialCount: specials.evil,
    servantCount: ratio.good - specials.good,
    minionCount: ratio.evil - specials.evil,
  };
}

/**
 * T037: Designate Lady of the Lake holder
 * Returns the player ID who should start with Lady of the Lake
 * Holder is the player to the left of the room manager (next in join order)
 */
export function designateLadyOfLakeHolder(
  playerIds: string[],       // Ordered by join time
  managerId: string
): string {
  if (playerIds.length === 0) {
    throw new Error('No players to designate Lady of the Lake holder');
  }

  const managerIndex = playerIds.indexOf(managerId);
  if (managerIndex === -1) {
    // Manager not found, default to first player after manager would be first player
    return playerIds[0];
  }

  // Holder is the next player in order (wraps around)
  const holderIndex = (managerIndex + 1) % playerIds.length;
  return playerIds[holderIndex];
}

/**
 * Get special role info for display
 */
export function getSpecialRoleInfo(role: SpecialRole) {
  return SPECIAL_ROLES[role];
}
