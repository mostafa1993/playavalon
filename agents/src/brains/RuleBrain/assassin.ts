/**
 * assassin — only the Assassin acts. Fires when game.phase === 'assassin'
 * (which only happens if good wins 3 quests).
 *
 * Heuristics (per assassin_guess_strategy in brain.options):
 *
 *   'random' (default): pick any non-self good-team player at random.
 *     We can identify good players in this phase because the server has
 *     revealed roles via player.revealed_role (set when phase === 'assassin').
 *     ...EXCEPT our Observation doesn't surface revealed_role yet.
 *     For P0-P4, we use our own role intel: assassin doesn't see Merlin,
 *     but knows the other evil teammates — so good players = everyone
 *     except known evil + self.
 *
 *   'most_proposed_good': (placeholder — currently same as random; tracking
 *     per-quest team membership requires either game_events queries or
 *     in-memory observation history that the engine doesn't keep yet.
 *     LLM brain in P5 would do this naturally.)
 *
 * Either way: the agent will guess SOMETHING, the server validates, and
 * the game proceeds to game_over.
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';
import { knownPlayerIds, sample, selfId } from './heuristics.js';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const game = ctx.observation.game;
  if (!game) return null;
  if (game.phase !== 'assassin') return null;
  if (!game.is_assassin) return null;             // only the assassin acts here
  if (!game.assassin_phase?.can_guess) return null;

  const me = selfId(ctx);
  const knownEvil = new Set(knownPlayerIds(ctx)); // our evil teammates (intel)
  knownEvil.add(me);                              // exclude self too

  const candidates = game.players
    .map((p) => p.id)
    .filter((id) => !knownEvil.has(id));

  if (candidates.length === 0) {
    ctx.logger.warn('assassin: no candidates after filtering known evil + self');
    return null;
  }

  const target = sample(candidates, 1, ctx.rng)[0]!;
  ctx.logger.debug(`intend: assassin_guess target=${target}`);
  return { kind: 'assassin_guess', target_id: target };
}
