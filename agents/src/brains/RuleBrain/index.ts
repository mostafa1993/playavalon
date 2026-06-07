/**
 * RuleBrain — phase-dispatching wrapper around per-phase decision modules.
 *
 * Each game phase has its own ~50-100 line module. RuleBrain.decide() reads
 * the current state from the observation and delegates. New phases get a
 * new module + a new switch arm — no other plumbing changes.
 *
 * Phase 0: pre-game / roles_distributed (confirmRole).
 * Phase 1: + team_building (teamBuilding), voting (voting).
 * P2+ adds: quest, quest_result, lady_of_lake, assassin, game_over.
 */

import type { Action } from '../../types/Action.js';
import type { Brain, BrainContext } from '../Brain.js';
import * as confirmRole from './confirmRole.js';
import * as teamBuilding from './teamBuilding.js';
import * as voting from './voting.js';
import * as quest from './quest.js';

export class RuleBrain implements Brain {
  async decide(ctx: BrainContext): Promise<Action | null> {
    const { room, game } = ctx.observation;

    // Pre-game (lobby or role-reveal): handle consent + confirm.
    if (room.status === 'waiting' || room.status === 'roles_distributed') {
      return confirmRole.decide(ctx);
    }

    // No game state yet despite status=started (brief race during creation).
    if (!game) {
      ctx.logger.trace('status=started but no game state yet; waiting');
      return null;
    }

    // In-game phase dispatch.
    switch (game.phase) {
      case 'team_building':
        return teamBuilding.decide(ctx);
      case 'voting':
        return voting.decide(ctx);
      case 'quest':
        return quest.decide(ctx);
      case 'quest_result':
        // Any agent can fire continue; server is idempotent (first wins,
        // others get a no-op). No per-phase module needed — just always
        // advance.
        return { kind: 'continue' };

      // Phase 3+ — fall through to noop for now.
      case 'lady_of_lake':
      case 'assassin':
        ctx.logger.trace(`phase=${game.phase} — not implemented yet, waiting`);
        return null;
      case 'game_over':
        // The engine's main loop handles game_over exit; brain returns
        // noop here so we don't double-act on the exit signal.
        return null;
    }
  }
}
