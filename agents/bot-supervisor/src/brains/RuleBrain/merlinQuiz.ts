/**
 * merlinQuiz — post-game guess of who Merlin was.
 *
 * Fires when:
 *   - game.phase === 'game_over' AND
 *   - merlin_quiz.enabled (Merlin was in the game) AND
 *   - merlin_quiz.active   (the quiz window is open) AND
 *   - !merlin_quiz.has_voted AND !merlin_quiz.has_skipped AND
 *   - the agent is NOT Merlin (Merlin doesn't vote in their own quiz)
 *
 * Strategy:
 *   - Random non-self player. The rule brain has no game-history tracking
 *     and no narrative model — random is the honest baseline. (The plan's
 *     "most_proposed_good" heuristic would need in-engine history.)
 *   - Could also skip by returning { target_id: null }; for now we always
 *     guess. Easy to change later.
 *
 * The quiz has a 60s timeout (per src/lib/domain/merlin-quiz.ts) — we
 * have plenty of head-room with our default jitter.
 */

import type { Action } from '../../types/Action.js';
import type { BrainContext } from '../Brain.js';
import { sample, selfId } from './heuristics.js';

export async function decide(ctx: BrainContext): Promise<Action | null> {
  const game = ctx.observation.game;
  const quiz = ctx.observation.merlin_quiz;
  if (!game || game.phase !== 'game_over') return null;
  if (!quiz || !quiz.enabled) return null;
  if (quiz.complete) return null;                 // quiz already wrapped
  if (quiz.has_voted || quiz.has_skipped) return null;
  if (ctx.identity.special_role === 'merlin') return null;  // Merlin doesn't vote

  const me = selfId(ctx);
  const candidates = game.players.map((p) => p.id).filter((id) => id !== me);
  if (candidates.length === 0) {
    ctx.logger.warn('merlin_quiz: no candidates; skipping');
    return { kind: 'merlin_quiz', target_id: null };
  }

  const target = sample(candidates, 1, ctx.rng)[0]!;
  ctx.logger.debug(`intend: merlin_quiz target=${target}`);
  return { kind: 'merlin_quiz', target_id: target };
}
