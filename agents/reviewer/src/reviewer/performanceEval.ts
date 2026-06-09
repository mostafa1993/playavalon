/**
 * Performance evaluation — god mode only, once per language at game end.
 *
 * Given the true roles + behavioral dossiers + quests + outcome, assess how well
 * each player played their actual role. Structured per-player output.
 */

import type { LLMClient } from './llm.js';
import type {
  DossierJson,
  GameMetaSnapshot,
  PlayerPerformance,
  QuestJson,
} from '../types.js';
import type { GameOutcome } from '../gamestate/db.js';

interface PerformanceOutput {
  performance: PlayerPerformance[];
}

export async function generatePerformanceEval(
  llm: LLMClient,
  meta: GameMetaSnapshot,
  outcome: GameOutcome,
  quests: QuestJson[],
  dossiers: DossierJson[],
  language: 'fa' | 'en'
): Promise<PlayerPerformance[]> {
  const promptFile =
    language === 'fa' ? 'performance-eval-fa.yml' : 'performance-eval-en.yml';

  const roster = meta.players.map((p) => ({
    display_name: p.display_name,
    seat_number: p.seat_number,
    role: p.role ?? 'good',
    special_role: p.special_role ?? null,
  }));

  const out = await llm.runJson<PerformanceOutput>(promptFile, {
    roster: JSON.stringify(roster, null, 2),
    outcome: JSON.stringify(outcome, null, 2),
    quests: JSON.stringify(quests, null, 2),
    dossiers: JSON.stringify(dossiers, null, 2),
  });
  return Array.isArray(out.performance) ? out.performance : [];
}
