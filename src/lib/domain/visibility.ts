/**
 * Merlin's intel modes and the Evil Ring, as pure functions: the decoy
 * warning, the Split Intel and Oberon Split Intel groups, the Evil Ring view,
 * and how many evil players are hidden from Merlin. What each role sees in an
 * ordinary game is read from the dealt roles by src/lib/supabase/roles.ts and
 * the role route.
 */

import type { SpecialRole } from '@/types/database';
import type { RoleConfig } from '@/types/role-config';
import type { SplitIntelGroups, SplitIntelVisibility, OberonSplitIntelGroups, OberonSplitIntelVisibility, EvilRingAssignments, EvilRingVisibility } from '@/types/game';
import { shuffleArray } from './decoy-selection';
import { countHiddenEvil } from './split-intel';
import { countHiddenEvilForOberonSplitIntel } from './oberon-split-intel';
import { getKnownTeammate, calculateHiddenCount } from './evil-ring-visibility';

/**
 * Role assignment for visibility calculations
 */
export interface RoleAssignment {
  playerId: string;
  playerName: string;
  role: 'good' | 'evil';
  specialRole: SpecialRole;
}

/**
 * T013: Generate warning message for Merlin with decoy mode
 * Combines decoy warning with hidden evil count information
 */
export function generateDecoyWarning(hiddenCount: number): string {
  const baseWarning = '⚠️ One of these players is actually good!';

  if (hiddenCount === 0) {
    return baseWarning;
  } else if (hiddenCount === 1) {
    return `${baseWarning} Also, 1 evil player is hidden from you.`;
  } else {
    return `${baseWarning} Also, ${hiddenCount} evil players are hidden from you.`;
  }
}

/**
 * T008: Get Split Intel visibility for Merlin
 * Feature 011: Returns two-group visibility structure
 */
export function getSplitIntelVisibility(
  allAssignments: RoleAssignment[],
  roleConfig: RoleConfig,
  splitIntelGroups: SplitIntelGroups
): SplitIntelVisibility {
  const hiddenCount = countHiddenEvil(roleConfig);

  // Build Certain Evil group with names
  const certainEvil = splitIntelGroups.certainEvilIds.map((id) => {
    const player = allAssignments.find((a) => a.playerId === id);
    return { id, name: player?.playerName || 'Unknown' };
  });

  // Build Mixed Intel group (1 evil + 1 good, shuffled to hide which is which)
  const mixedPlayers = [
    splitIntelGroups.mixedEvilId,
    splitIntelGroups.mixedGoodId,
  ].map((id) => {
    const player = allAssignments.find((a) => a.playerId === id);
    return { id, name: player?.playerName || 'Unknown' };
  });
  // Shuffle to hide order (evil vs good)
  const mixedIntel = shuffleArray([...mixedPlayers]);

  // Generate hidden warning if applicable
  let hiddenWarning: string | undefined;
  if (hiddenCount === 1) {
    hiddenWarning = '1 evil player is hidden from you';
  } else if (hiddenCount >= 2) {
    hiddenWarning = `${hiddenCount} evil players are hidden from you`;
  }

  return {
    enabled: true,
    certainEvil,
    mixedIntel,
    hiddenCount,
    certainLabel: '🎯 Certain Evil',
    certainDescription: 'These players are definitely evil',
    mixedLabel: '❓ Mixed Intel',
    mixedDescription: "One is evil, one is good - you don't know which",
    hiddenWarning,
  };
}

/**
 * T010: Get Oberon Split Intel visibility for Merlin
 * Feature 018: Returns two-group visibility structure with Oberon always in mixed
 */
export function getOberonSplitIntelVisibility(
  allAssignments: RoleAssignment[],
  roleConfig: RoleConfig,
  oberonSplitIntelGroups: OberonSplitIntelGroups
): OberonSplitIntelVisibility {
  const hiddenCount = countHiddenEvilForOberonSplitIntel(roleConfig);

  // Build Certain Evil group with names (Morgana, Assassin - NOT Oberon)
  const certainEvil = oberonSplitIntelGroups.certainEvilIds.map((id) => {
    const player = allAssignments.find((a) => a.playerId === id);
    return { id, name: player?.playerName || 'Unknown' };
  });

  // Build Mixed Intel group (Oberon + 1 good, shuffled to hide which is which)
  const mixedPlayers = [
    oberonSplitIntelGroups.oberonId,
    oberonSplitIntelGroups.mixedGoodId,
  ].map((id) => {
    const player = allAssignments.find((a) => a.playerId === id);
    return { id, name: player?.playerName || 'Unknown' };
  });
  // Shuffle to hide order (Oberon vs good)
  const mixedIntel = shuffleArray([...mixedPlayers]);

  // Generate hidden warning if applicable (only Mordred can be hidden)
  let hiddenWarning: string | undefined;
  if (hiddenCount === 1) {
    hiddenWarning = '1 evil player is hidden from you';
  } else if (hiddenCount >= 2) {
    // This shouldn't happen with Oberon Split Intel (no Oberon Chaos)
    hiddenWarning = `${hiddenCount} evil players are hidden from you`;
  }

  return {
    enabled: true,
    certainEvil,
    mixedIntel,
    hiddenCount,
    certainLabel: '🎯 Certain Evil',
    certainDescription: 'These players are definitely evil',
    mixedLabel: '❓ Mixed Intel',
    mixedDescription: 'One is evil (Oberon), one is good',
    hiddenWarning,
  };
}

/**
 * T020: Get Evil Ring visibility for an evil player
 * Feature 019: Returns the single known teammate for ring visibility mode
 */
export function getEvilRingVisibility(
  myPlayerId: string,
  allAssignments: RoleAssignment[],
  ringAssignments: EvilRingAssignments,
  roleConfig: RoleConfig
): EvilRingVisibility | null {
  // Get the known teammate ID from ring assignments
  const knownTeammateId = getKnownTeammate(myPlayerId, ringAssignments);
  if (!knownTeammateId) {
    // Player not in ring (e.g., Oberon)
    return null;
  }

  // Find the teammate's name
  const teammate = allAssignments.find((a) => a.playerId === knownTeammateId);
  if (!teammate) {
    return null;
  }

  // Calculate ring size (non-Oberon evil count)
  const nonOberonEvil = allAssignments.filter(
    (a) =>
      a.role === 'evil' &&
      a.specialRole !== 'oberon_standard' &&
      a.specialRole !== 'oberon_chaos'
  );
  const ringSize = nonOberonEvil.length;

  // Check if Oberon is in the game
  const hasOberon = !!roleConfig.oberon;

  return {
    enabled: true,
    knownTeammate: {
      id: knownTeammateId,
      name: teammate.playerName,
    },
    hiddenCount: calculateHiddenCount(ringSize, hasOberon),
    explanation: 'Ring Visibility Mode: You only know one teammate.',
  };
}

/**
 * Count evil players hidden from Merlin
 */
export function countHiddenEvilFromMerlin(roleConfig: RoleConfig): number {
  return (
    (roleConfig.mordred ? 1 : 0) +
    (roleConfig.oberon === 'chaos' ? 1 : 0)
  );
}
