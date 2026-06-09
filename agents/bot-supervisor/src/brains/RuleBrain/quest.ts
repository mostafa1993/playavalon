/**
 * quest — team members submit success/fail for the current quest.
 *
 * Rules (per plan §8):
 *
 *   - Not on the team? noop.
 *   - Already submitted? noop (idempotency; staleness guard also catches this).
 *   - GOOD → success. Always. Good never fails a quest.
 *   - LUNATIC → fail. Server enforces this regardless of what we send;
 *               we send `fail` proactively to avoid a 400 from the
 *               "can-submit-action" validator.
 *   - BRUTE on Q4 or Q5 → success. Server enforces brute can only fail
 *               on Q1-Q3; sending `fail` on Q4/Q5 = 400. Coerce to success.
 *   - OTHER EVIL → choose per evil_fail_strategy:
 *       'minimum_to_win': fail iff (number of evil on team) === 1 or
 *                         fails_required === 1. Otherwise the first listed
 *                         evil teammate fails — a naïve coordination
 *                         heuristic to avoid both fails landing on a
 *                         2-fails-required quest.
 *       'aggressive': always fail.
 *       'random': 50/50.
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';
import { knownPlayerIds, selfId } from './heuristics.js';

type FailStrategy = 'minimum_to_win' | 'aggressive' | 'random';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const game = ctx.observation.game;
  if (!game) return null;
  if (game.phase !== 'quest') return null;
  if (!game.am_team_member) return null;        // not on the team → nothing to do
  if (game.has_submitted_action) return null;   // already played our card

  const role = ctx.identity.role;
  const special = ctx.identity.special_role;
  const currentQuest = game.current_quest;
  const failsRequired = game.quest_requirement.fails_required;

  // GOOD always succeeds.
  if (role === 'good') {
    ctx.logger.debug('quest action: success (good)');
    return { kind: 'quest_action', choice: 'success' };
  }

  // EVIL specials with server-enforced constraints:
  if (special === 'lunatic') {
    ctx.logger.debug('quest action: fail (lunatic forced)');
    return { kind: 'quest_action', choice: 'fail' };
  }
  if (special === 'brute' && (currentQuest === 4 || currentQuest === 5)) {
    ctx.logger.debug(`quest action: success (brute can't fail Q${currentQuest})`);
    return { kind: 'quest_action', choice: 'success' };
  }

  // Other evil — heuristic.
  const strategyOpt = (ctx.options as { evil_fail_strategy?: FailStrategy }).evil_fail_strategy;
  const strategy: FailStrategy = strategyOpt ?? 'minimum_to_win';

  if (strategy === 'aggressive') {
    return { kind: 'quest_action', choice: 'fail' };
  }
  if (strategy === 'random') {
    return { kind: 'quest_action', choice: ctx.rng() < 0.5 ? 'fail' : 'success' };
  }

  // 'minimum_to_win' — coordinate so we don't double-fail when only one is needed.
  if (failsRequired === 1) {
    // Only one fail needed — somebody has to do it. Pick the lowest-ID evil
    // on the team to fail (deterministic so all evil agree without comms).
    const me = selfId(ctx);
    const teamIds = game.current_proposal?.team_member_ids ?? [];
    const intel = new Set(knownPlayerIds(ctx)); // known evil teammates from role intel
    const isOberon = special === 'oberon_standard' || special === 'oberon_chaos';

    // Oberon doesn't see teammates — assume we might be the only evil on
    // the team and just fail (worst case: 2 fails land, still a fail).
    if (isOberon) {
      ctx.logger.debug('quest action: fail (oberon, can\'t coordinate)');
      return { kind: 'quest_action', choice: 'fail' };
    }

    // Build the sorted list of evil-on-team (me + known teammates).
    const evilOnTeam = [me, ...intel].filter((id) => teamIds.includes(id)).sort();
    const designatedFailer = evilOnTeam[0];

    if (designatedFailer === me) {
      ctx.logger.debug('quest action: fail (minimum_to_win: I am the designated failer)');
      return { kind: 'quest_action', choice: 'fail' };
    } else {
      ctx.logger.debug('quest action: success (minimum_to_win: someone else fails)');
      return { kind: 'quest_action', choice: 'success' };
    }
  }

  // fails_required >= 2 (only Q4 at 7+ players). Both/all known evil on
  // team must fail to make the quest fail. Coordinate by failing always.
  ctx.logger.debug('quest action: fail (minimum_to_win, fails_required>=2 needs all evil to fail)');
  return { kind: 'quest_action', choice: 'fail' };
}
