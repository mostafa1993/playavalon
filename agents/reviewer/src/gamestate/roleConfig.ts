/**
 * Role-configuration summary for the BLIND reviewer.
 *
 * The blind detective never learns who has which role, but the game's SETUP is
 * public knowledge in Avalon: how many good/evil seats there are and which
 * special roles were enabled. Giving the detective that lets it constrain its
 * guesses to roles that actually exist in this match.
 *
 * This mirrors `computeRolesInPlay` / `ROLE_RATIOS` from the web app
 * (src/lib/domain/role-config.ts, src/lib/utils/constants.ts). The reviewer is a
 * separate package and can't import from `src/`, so the small amount of logic
 * is duplicated here. Keep the two in sync if the app's role rules change.
 */

/** Good/evil seat counts by player count (Avalon standard, 5–10 players). */
const ROLE_RATIOS: Record<number, { good: number; evil: number }> = {
  5: { good: 3, evil: 2 },
  6: { good: 4, evil: 2 },
  7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 },
  9: { good: 6, evil: 3 },
  10: { good: 6, evil: 4 },
};

/** The subset of rooms.role_config fields that affect which roles are in play. */
export interface ReviewerRoleConfig {
  /** True: Merlin and the Assassin are dealt. False: neither is; the
   *  Assassin's seat is a plain Minion. */
  merlin: boolean;
  percival?: boolean;
  morgana?: boolean;
  mordred?: boolean;
  oberon?: 'standard' | 'chaos';
  lunatic?: boolean;
  brute?: boolean;
}

/** A stored rooms.role_config, refused unless `merlin` is a boolean. */
export function readRoleConfig(raw: unknown): ReviewerRoleConfig {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { merlin?: unknown }).merlin !== 'boolean') {
    throw new Error(`role_config has no boolean merlin: ${JSON.stringify(raw)}`);
  }
  return raw as ReviewerRoleConfig;
}

export interface RolesInPlay {
  goodCount: number;
  evilCount: number;
  /** Whether Merlin and the Assassin are dealt. */
  merlinInPlay: boolean;
  /** Named special roles present (generic Servants/Minions are not listed). */
  specialRoles: string[];
}

/**
 * Build the public role-configuration summary, or null if the player count is
 * outside the supported 5–10 range (caller then omits it from prompts).
 */
export function summarizeRoleConfig(
  playerCount: number,
  config: ReviewerRoleConfig
): RolesInPlay | null {
  const ratio = ROLE_RATIOS[playerCount];
  if (!ratio) return null;

  const specialRoles: string[] = [];

  // Good team.
  if (config.merlin) specialRoles.push('Merlin');
  if (config.percival) specialRoles.push('Percival');

  // Evil team (the Assassin comes with Merlin).
  if (config.merlin) specialRoles.push('Assassin');
  if (config.morgana) specialRoles.push('Morgana');
  if (config.mordred) specialRoles.push('Mordred');
  if (config.oberon === 'standard') specialRoles.push('Oberon');
  if (config.oberon === 'chaos') specialRoles.push('Oberon (Chaos)');
  if (config.lunatic) specialRoles.push('Lunatic');
  if (config.brute) specialRoles.push('Brute');

  return { goodCount: ratio.good, evilCount: ratio.evil, merlinInPlay: config.merlin, specialRoles };
}

/**
 * Render the configuration as a prompt block. Used by both the per-round guess
 * tracker and the final blind narrative so the detective sees the same setup.
 */
export function formatRolesInPlay(roles: RolesInPlay | null | undefined): string {
  if (!roles) return '(role configuration unavailable)';
  const total = roles.goodCount + roles.evilCount;
  const special = roles.specialRoles.length > 0 ? roles.specialRoles.join(', ') : 'none';
  return [
    "This game's setup (public knowledge — NOT a role assignment):",
    `- ${total} players: ${roles.goodCount} good, ${roles.evilCount} evil.`,
    `- Special roles in play: ${special}.`,
    ...(roles.merlinInPlay ? [] : ['- No Merlin and no Assassin in this game.']),
    '- Any remaining players are generic Loyal Servants (good) or Minions of Mordred (evil).',
    '- Only these roles exist in this game — never guess a role that is not in this list.',
  ].join('\n');
}
