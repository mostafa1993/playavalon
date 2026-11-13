/**
 * Role distribution logic (pure functions)
 * Assigns roles based on Avalon standard ratios
 * Includes special characters: Merlin, Assassin, Percival, Morgana, etc.
 */

import { ROLE_RATIOS } from '@/lib/utils/constants';
import type { RoleDistribution } from '@/types/role';
import type { RoleConfig } from '@/types/role-config';

// Base alignment
export type Alignment = 'good' | 'evil';

// Specific character roles
// Phase 2: Split oberon into oberon_standard and oberon_chaos
// Feature 020: Added lunatic and brute from Big Box expansion
export type SpecialRole =
  | 'merlin'          // Good - knows evil players (except Mordred, Oberon Chaos)
  | 'percival'        // Good - knows Merlin (but Morgana looks the same)
  | 'assassin'        // Evil - can assassinate Merlin at end
  | 'morgana'         // Evil - appears as Merlin to Percival
  | 'mordred'         // Evil - hidden from Merlin
  | 'oberon_standard' // Evil - visible to Merlin, hidden from evil team
  | 'oberon_chaos'    // Evil - hidden from everyone including Merlin
  | 'servant'         // Good - basic loyal servant
  | 'minion'          // Evil - basic minion
  | 'lunatic'         // Evil - MUST fail every quest (Big Box)
  | 'brute';          // Evil - can only fail quests 1-3 (Big Box)

// For database storage, we still use 'good' | 'evil' as the base role
export type Role = 'good' | 'evil';

export interface RoleAssignment {
  playerId: string;
  role: Role;  // Base alignment for DB storage
  specialRole: SpecialRole;  // Specific character
}

export interface RoleInfo {
  role: Role;
  specialRole: SpecialRole;
  role_name: string;
  role_description: string;
  knows_evil: boolean;  // Can see evil players (Merlin)
  known_to_merlin: boolean;  // Visible to Merlin (not Mordred)
  knows_merlin: boolean;  // Can see Merlin candidates (Percival)
  appears_as_merlin: boolean;  // Appears as Merlin to Percival (Morgana)
}

/**
 * Get role ratio for player count
 */
export function getRoleRatio(playerCount: number): RoleDistribution {
  const ratio = ROLE_RATIOS[playerCount];
  if (!ratio) {
    throw new Error(`Invalid player count: ${playerCount}. Must be 5-10.`);
  }
  return ratio;
}

/**
 * Shuffle array using Fisher-Yates algorithm
 * Creates a new array, doesn't mutate the original
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * T019: Generate role pool based on configuration
 * Uses roleConfig to determine which special roles to include
 */
export function generateRolePool(
  roleConfig: RoleConfig,
  playerCount: number
): { good: SpecialRole[]; evil: SpecialRole[] } {
  const ratio = getRoleRatio(playerCount);

  // Build good team roles
  const goodRoles: SpecialRole[] = [];
  if (roleConfig.merlin) goodRoles.push('merlin');
  if (roleConfig.percival) goodRoles.push('percival');

  // Fill remaining good slots with servants
  while (goodRoles.length < ratio.good) {
    goodRoles.push('servant');
  }

  // Build evil team roles
  // The Assassin comes with Merlin; without Merlin that seat is a plain Minion
  const evilRoles: SpecialRole[] = [];
  if (roleConfig.merlin) evilRoles.push('assassin');
  if (roleConfig.morgana) evilRoles.push('morgana');
  if (roleConfig.mordred) evilRoles.push('mordred');
  if (roleConfig.oberon === 'standard') evilRoles.push('oberon_standard');
  if (roleConfig.oberon === 'chaos') evilRoles.push('oberon_chaos');
  // Feature 020: Big Box roles
  if (roleConfig.lunatic) evilRoles.push('lunatic');
  if (roleConfig.brute) evilRoles.push('brute');

  // Fill remaining evil slots with minions
  while (evilRoles.length < ratio.evil) {
    evilRoles.push('minion');
  }

  return { good: goodRoles, evil: evilRoles };
}

/**
 * T018: Distribute roles to players based on configuration
 */
export function distributeRoles(
  playerIds: string[],
  roleConfig: RoleConfig
): RoleAssignment[] {
  const specialRoles = generateRolePool(roleConfig, playerIds.length);

  // Create role pool with special roles
  const allRoles: { role: Role; specialRole: SpecialRole }[] = [
    ...specialRoles.good.map(sr => ({ role: 'good' as Role, specialRole: sr })),
    ...specialRoles.evil.map(sr => ({ role: 'evil' as Role, specialRole: sr })),
  ];

  // Shuffle roles
  const shuffledRoles = shuffleArray(allRoles);

  // Shuffle players (for extra randomness)
  const shuffledPlayers = shuffleArray(playerIds);

  // Assign roles
  return shuffledPlayers.map((playerId, index) => ({
    playerId,
    role: shuffledRoles[index].role,
    specialRole: shuffledRoles[index].specialRole,
  }));
}

/**
 * Role information database
 */
const ROLE_INFO: Record<SpecialRole, Omit<RoleInfo, 'role'>> = {
  merlin: {
    specialRole: 'merlin',
    role_name: 'Merlin',
    role_description: 'You are Merlin, the wise wizard. You know the identities of the evil players (except Mordred). Guide your team to victory, but beware - if the Assassin discovers you, all is lost!',
    knows_evil: true,
    known_to_merlin: false,  // Merlin doesn't see himself
    knows_merlin: false,
    appears_as_merlin: false,
  },
  percival: {
    specialRole: 'percival',
    role_name: 'Percival',
    role_description: 'You are Percival, the loyal knight. You know who Merlin is (but Morgana may appear as Merlin too). Protect Merlin at all costs!',
    knows_evil: false,
    known_to_merlin: false,
    knows_merlin: true,
    appears_as_merlin: false,
  },
  servant: {
    specialRole: 'servant',
    role_name: 'Loyal Servant of Arthur',
    role_description: 'You are a loyal servant of King Arthur. Work with your fellow knights to complete quests and identify the traitors among you.',
    knows_evil: false,
    known_to_merlin: false,
    knows_merlin: false,
    appears_as_merlin: false,
  },
  assassin: {
    specialRole: 'assassin',
    role_name: 'The Assassin',
    role_description: 'You are the Assassin, deadliest of Mordred\'s minions. If the good team wins, you have one chance to assassinate Merlin and steal victory!',
    knows_evil: false,  // Knows evil via being evil, not special ability
    known_to_merlin: true,
    knows_merlin: false,
    appears_as_merlin: false,
  },
  morgana: {
    specialRole: 'morgana',
    role_name: 'Morgana',
    role_description: 'You are Morgana, the dark enchantress. You appear as Merlin to Percival. Use this to sow confusion and protect the real evil team!',
    knows_evil: false,
    known_to_merlin: true,
    knows_merlin: false,
    appears_as_merlin: true,
  },
  mordred: {
    specialRole: 'mordred',
    role_name: 'Mordred',
    role_description: 'You are Mordred, the dark lord himself. Even Merlin cannot see your evil nature. Lead your minions to victory from the shadows!',
    knows_evil: false,
    known_to_merlin: false,  // Hidden from Merlin!
    knows_merlin: false,
    appears_as_merlin: false,
  },
  oberon_standard: {
    specialRole: 'oberon_standard',
    role_name: 'Oberon',
    role_description: 'You are Oberon, the mysterious evil. You do not know the other evil players, and they do not know you. Merlin can see you. Work alone to sabotage the quests!',
    knows_evil: false,
    known_to_merlin: true,  // Merlin CAN see Oberon Standard
    knows_merlin: false,
    appears_as_merlin: false,
  },
  oberon_chaos: {
    specialRole: 'oberon_chaos',
    role_name: 'Oberon (Chaos)',
    role_description: 'You are Oberon in Chaos mode! No one knows you are evil - not even Merlin! You work completely alone.',
    knows_evil: false,
    known_to_merlin: false, // KEY: Hidden even from Merlin!
    knows_merlin: false,
    appears_as_merlin: false,
  },
  minion: {
    specialRole: 'minion',
    role_name: 'Minion of Mordred',
    role_description: 'You serve the dark lord Mordred. Sabotage the quests and avoid detection. You know who your fellow minions are.',
    knows_evil: false,
    known_to_merlin: true,
    knows_merlin: false,
    appears_as_merlin: false,
  },
  // Feature 020: Big Box Expansion Roles
  lunatic: {
    specialRole: 'lunatic',
    role_name: 'Lunatic',
    role_description: 'You are the Lunatic, a servant of Mordred driven by madness. You MUST play Fail on every quest you join—you have no choice.',
    knows_evil: false,
    known_to_merlin: true,
    knows_merlin: false,
    appears_as_merlin: false,
  },
  brute: {
    specialRole: 'brute',
    role_name: 'Brute',
    role_description: 'You are the Brute, a servant of Mordred who has some tricks, but not many. You can only play Fail on Quests 1, 2, and 3. On Quests 4 and 5, you MUST play Success. Use your early sabotage wisely!',
    knows_evil: false,
    known_to_merlin: true,
    knows_merlin: false,
    appears_as_merlin: false,
  },
};

/**
 * Oberon (Standard)'s description in a game without Merlin, where no one sees him
 */
const OBERON_STANDARD_DESCRIPTION_WITHOUT_MERLIN = 'You are Oberon, the mysterious evil. You do not know the other evil players, and they do not know you. Work alone to sabotage the quests!';

/**
 * Get human-readable role info for a special role
 *
 * @param merlinInPlay Whether the game has a Merlin; Oberon (Standard)'s description names him only then
 */
export function getRoleInfo(role: Role, merlinInPlay: boolean, specialRole?: SpecialRole): RoleInfo {
  // Default to basic roles if no special role specified
  const sr = specialRole || (role === 'good' ? 'servant' : 'minion');
  const info = ROLE_INFO[sr];

  if (sr === 'oberon_standard' && !merlinInPlay) {
    return {
      role,
      ...info,
      role_description: OBERON_STANDARD_DESCRIPTION_WITHOUT_MERLIN,
    };
  }

  return {
    role,
    ...info,
  };
}
