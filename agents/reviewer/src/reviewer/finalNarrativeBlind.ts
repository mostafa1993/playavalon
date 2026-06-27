/**
 * Blind end-summary — runs once per language at game end (blind mode only).
 *
 * Takes the role-free roster, outcome, quests, behavioral dossiers, and the
 * detective's evolving guess timeline + final guesses, and produces a freeform
 * prose recap + final guesses in the target language. It is NEVER given roles —
 * `final_summary` is pure deduction prose.
 */

import type { LLMClient } from '@avalon/shared';
import type {
  DossierJson,
  GameMetaSnapshot,
  GuessRound,
  QuestJson,
  RoleGuess,
} from '../types.js';
import type { GameOutcome } from '../gamestate/db.js';
import { formatRolesInPlay } from '../gamestate/roleConfig.js';

export interface BlindSummaryContext {
  meta: GameMetaSnapshot; // role-free
  outcome: GameOutcome;
  quests: QuestJson[];
  dossiers: DossierJson[];
  timeline: GuessRound[];
  finalGuesses: RoleGuess[];
}

export async function generateBlindSummary(
  llm: LLMClient,
  ctx: BlindSummaryContext,
  language: 'fa' | 'en'
): Promise<string> {
  const promptFile =
    language === 'fa' ? 'final-narrative-blind-fa.yml' : 'final-narrative-blind-en.yml';

  const roster = ctx.meta.players.map((p) => ({
    display_name: p.display_name,
    seat_number: p.seat_number,
  }));

  return llm.runText(promptFile, {
    roster: JSON.stringify(roster, null, 2),
    roles_in_play: formatRolesInPlay(ctx.meta.rolesInPlay),
    outcome: JSON.stringify(ctx.outcome, null, 2),
    quests: JSON.stringify(ctx.quests, null, 2),
    dossiers: JSON.stringify(ctx.dossiers, null, 2),
    timeline: JSON.stringify(ctx.timeline, null, 2),
    final_guesses: JSON.stringify(ctx.finalGuesses, null, 2),
  });
}
