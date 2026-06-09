/**
 * confirmRole — pre-game phase decisions.
 *
 * Two responsibilities:
 *   1. If the room has AI review enabled and we haven't consented, send
 *      consent_ai first (the distribute API will reject without all consents).
 *   2. Once the manager distributes roles, send confirm_role.
 *
 * Returns null in all other situations (already confirmed, waiting for
 * more players, etc.).
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const { room } = ctx.observation;

  // (1) AI consent gate — only if the room enabled it and we haven't accepted yet.
  if (room.ai_review_enabled && !room.ai_consent_given) {
    ctx.logger.debug('intend: consent_ai (room has AI review enabled)');
    return { kind: 'consent_ai' };
  }

  // (2) Confirm role once it's been distributed and we haven't confirmed.
  if (room.roles_distributed && !room.is_confirmed) {
    ctx.logger.debug('intend: confirm_role (roles distributed, not yet confirmed)');
    return { kind: 'confirm_role' };
  }

  return null;
}
