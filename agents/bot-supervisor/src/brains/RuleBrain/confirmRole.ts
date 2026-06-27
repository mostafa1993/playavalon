/**
 * confirmRole — pre-game phase decisions.
 *
 * Once the manager distributes roles, send confirm_role. Returns null in all
 * other situations (already confirmed, waiting for more players, etc.).
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const { room } = ctx.observation;

  // Confirm role once it's been distributed and we haven't confirmed.
  if (room.roles_distributed && !room.is_confirmed) {
    ctx.logger.debug('intend: confirm_role (roles distributed, not yet confirmed)');
    return { kind: 'confirm_role' };
  }

  return null;
}
