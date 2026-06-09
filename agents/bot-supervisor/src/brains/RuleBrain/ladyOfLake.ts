/**
 * ladyOfLake — only the current holder of the Lady of the Lake token acts.
 *
 * Heuristic (simple):
 *   - Investigate any player who hasn't been investigated yet AND isn't
 *     ourselves AND isn't a previous lady-holder (those are by design
 *     ineligible; the server would reject anyway).
 *   - Tiebreak via injectable rng.
 *
 * The result of the investigation is never seen by the brain itself —
 * it's only revealed to the holder via the UI/role-fetch. The agent
 * effectively flies blind here, but for testing infrastructure this
 * is fine (the LLM brain in P5 is where smart "do I trust this result"
 * logic would live).
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';
import { sample, selfId } from './heuristics.js';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const game = ctx.observation.game;
  if (!game) return null;
  if (game.phase !== 'lady_of_lake') return null;
  if (!game.lady_of_lake) return null;       // shouldn't happen in this phase
  if (!game.lady_of_lake.can_investigate) return null;  // not our turn / wrong phase

  const me = selfId(ctx);
  const investigated = new Set(game.lady_of_lake.investigated_player_ids);
  const eligible = game.players
    .map((p) => p.id)
    .filter((id) => id !== me && !investigated.has(id));

  if (eligible.length === 0) {
    ctx.logger.warn('lady_of_lake: no eligible targets; skipping');
    return null;
  }

  const target = sample(eligible, 1, ctx.rng)[0]!;
  ctx.logger.debug(`intend: lady_investigate target=${target}`);
  return { kind: 'lady_investigate', target_id: target };
}
