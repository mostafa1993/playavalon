/**
 * Brain — the decision-making contract. Engines call decide() on every
 * observation tick. Brains return an Action (or null for "do nothing").
 *
 * The whole point of separating Brain from Engine is so we can swap
 * RuleBrain → LlmBrain (Phase 5) without touching anything but a factory.
 * Brains should be pure-ish: same context → same action (modulo `rng()`).
 */

import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { Action } from '../types/Action.js';
import type { AgentLogger } from '../util/logger.js';
import type { TalkMemory } from '../voice/talkMemory.js';

export interface BrainContext {
  /** Stable info about the agent itself: user_id, role, intel, etc. */
  identity: Identity;
  /** The current game/room state snapshot (fetched by the Observer). */
  observation: Observation;
  /** Brain-specific options from yaml (`brain.options`). */
  options: Record<string, unknown>;
  /** Injectable RNG so brain decisions are reproducible in tests. */
  rng: () => number;
  /** Scoped logger that prefixes lines with the agent's name. */
  logger: AgentLogger;
  /** Smart mode: the bot's running memory (transcribed talk + game events).
   *  Absent/null for stupid bots and in tests. */
  talk?: TalkMemory | null;
}

export interface Brain {
  /** Decide what to do right now. Return null if no action is appropriate. */
  decide(ctx: BrainContext): Promise<Action | null>;
}
