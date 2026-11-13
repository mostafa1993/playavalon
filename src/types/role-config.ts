/**
 * Role Configuration Types for Phase 2
 * Defines the structure for configurable special roles
 */

/**
 * Oberon mode variants
 * - 'standard': Visible to Merlin, invisible to/from other evil
 * - 'chaos': Invisible to everyone including Merlin
 */
export type OberonMode = 'standard' | 'chaos';

/**
 * Role configuration stored in rooms.role_config JSONB column
 * Every setup states whether Merlin is in the game; the other options are optional.
 */
export interface RoleConfig {
  // Merlin, who brings the Assassin. false = neither is dealt (that evil seat is
  // a plain Minion) and Good wins on its third successful quest.
  merlin: boolean;

  // Optional Good roles (max 1 each)
  percival?: boolean;

  // Optional Evil roles (max 1 each)
  morgana?: boolean;
  mordred?: boolean;
  oberon?: OberonMode;

  // Game options
  ladyOfLake?: boolean;

  // Feature 009: Merlin Decoy Mode
  // When enabled, one random good player (not Merlin) appears evil to Merlin
  merlin_decoy_enabled?: boolean;

  // Feature 011: Merlin Split Intel Mode
  // When enabled, Merlin sees two groups: Certain Evil (guaranteed evil) and Mixed Intel (1 evil + 1 good)
  // Mutually exclusive with merlin_decoy_enabled
  merlin_split_intel_enabled?: boolean;

  // Feature 018: Oberon Split Intel Mode
  // When enabled, Oberon is ALWAYS in the mixed group with one random good player
  // Certain Evil group contains other visible evil (Morgana, Assassin)
  // Prerequisite: oberon === 'standard' (not available with Oberon Chaos or no Oberon)
  // Mutually exclusive with merlin_decoy_enabled AND merlin_split_intel_enabled
  oberon_split_intel_enabled?: boolean;

  // Feature 019: Evil Ring Visibility Mode
  // When enabled, evil players only see ONE teammate each in a circular chain pattern
  // Prerequisite: 3+ non-Oberon evil players (7+ total players without Oberon, 10 with Oberon)
  // Compatible with all Merlin visibility modes (Split Intel, Oberon Split Intel, Decoy)
  evil_ring_visibility_enabled?: boolean;

  // Feature 020: Big Box Expansion Roles
  // Lunatic: Must play Fail on every quest (7+ players required)
  lunatic?: boolean;
  // Brute: Can only Fail on Quests 1-3, must play Success on Quests 4-5 (7+ players required)
  brute?: boolean;
}

/**
 * Role configuration validation result
 */
export interface RoleConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Type guard to check if oberon mode is valid
 */
export function isValidOberonMode(mode: unknown): mode is OberonMode {
  return mode === 'standard' || mode === 'chaos';
}

/**
 * The public options of a setup, and nothing else. A setup sent by a client is
 * stored through this, so it can't carry the `_`-prefixed assignments that role
 * distribution writes into a room's setup (who the decoy is, the Split Intel
 * groups, the Evil Ring), or anything unknown.
 */
export function pickRoleConfig(config: RoleConfig): RoleConfig {
  const picked: RoleConfig = { merlin: config.merlin };
  if (config.percival !== undefined) picked.percival = config.percival;
  if (config.morgana !== undefined) picked.morgana = config.morgana;
  if (config.mordred !== undefined) picked.mordred = config.mordred;
  if (config.oberon !== undefined) picked.oberon = config.oberon;
  if (config.ladyOfLake !== undefined) picked.ladyOfLake = config.ladyOfLake;
  if (config.merlin_decoy_enabled !== undefined) picked.merlin_decoy_enabled = config.merlin_decoy_enabled;
  if (config.merlin_split_intel_enabled !== undefined) picked.merlin_split_intel_enabled = config.merlin_split_intel_enabled;
  if (config.oberon_split_intel_enabled !== undefined) picked.oberon_split_intel_enabled = config.oberon_split_intel_enabled;
  if (config.evil_ring_visibility_enabled !== undefined) picked.evil_ring_visibility_enabled = config.evil_ring_visibility_enabled;
  if (config.lunatic !== undefined) picked.lunatic = config.lunatic;
  if (config.brute !== undefined) picked.brute = config.brute;
  return picked;
}

/**
 * Type guard to check if role config is valid structure
 */
export function isValidRoleConfig(config: unknown): config is RoleConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Merlin in or out must be stated
  if (typeof c.merlin !== 'boolean') return false;

  // Check optional boolean fields
  if (c.percival !== undefined && typeof c.percival !== 'boolean') return false;
  if (c.morgana !== undefined && typeof c.morgana !== 'boolean') return false;
  if (c.mordred !== undefined && typeof c.mordred !== 'boolean') return false;
  if (c.ladyOfLake !== undefined && typeof c.ladyOfLake !== 'boolean') return false;
  if (c.merlin_decoy_enabled !== undefined && typeof c.merlin_decoy_enabled !== 'boolean') return false;
  if (c.merlin_split_intel_enabled !== undefined && typeof c.merlin_split_intel_enabled !== 'boolean') return false;
  if (c.oberon_split_intel_enabled !== undefined && typeof c.oberon_split_intel_enabled !== 'boolean') return false;
  if (c.evil_ring_visibility_enabled !== undefined && typeof c.evil_ring_visibility_enabled !== 'boolean') return false;

  // Check oberon mode
  if (c.oberon !== undefined && !isValidOberonMode(c.oberon)) return false;

  // Feature 020: Check Big Box role fields
  if (c.lunatic !== undefined && typeof c.lunatic !== 'boolean') return false;
  if (c.brute !== undefined && typeof c.brute !== 'boolean') return false;

  return true;
}
