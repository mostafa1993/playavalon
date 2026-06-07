/**
 * RuleBrain — phase-dispatching wrapper around per-phase decision modules.
 *
 * Each game phase has its own ~50-100 line module. RuleBrain.decide() reads
 * the current phase from the observation and delegates. New phases get a
 * new module + a new switch arm — no other plumbing changes.
 *
 * Phase 0 implements: pre-game / roles_distributed (confirmRole).
 * P1+ adds: team_building, voting, quest, quest_result, lady, assassin,
 * game_over.
 */

import type { Action } from '../../types/Action.js';
import type { Brain, BrainContext } from '../Brain.js';
import * as confirmRole from './confirmRole.js';

export class RuleBrain implements Brain {
  async decide(ctx: BrainContext): Promise<Action | null> {
    const { room, game } = ctx.observation;

    // Pre-game: confirm role + AI consent flow. Runs whenever the game
    // hasn't started yet, regardless of room.status nuances.
    if (!game || !ctx.observation.self.is_in_room === false) {
      // We're in the lobby; defer to confirmRole logic.
    }
    if (room.status === 'waiting' || room.status === 'roles_distributed') {
      return confirmRole.decide(ctx);
    }

    // Post-game-start dispatch — populated in later phases.
    // For P0, just noop on anything else.
    if (game) {
      ctx.logger.trace(`phase=${game.phase} — not implemented in P0`);
    }
    return null;
  }
}
