/**
 * Quest synthesizer — runs once per quest, after the quest's last turn
 * has been transcribed + summarized.
 *
 * Pulls:
 *   - all turn JSONs for the quest from disk (for per-turn summaries)
 *   - proposals, votes, mission result (structured), through GameReads
 *
 * Writes: quest_<n>.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { LLMClient } from '@avalon/shared';
import type { GameReads } from '../gamestate/gameReads.js';
import { writeJsonAtomic } from '../storage/atomicWrite.js';
import { questPath } from '../storage/layout.js';
import type { QuestJson, QuestSynthesis, TurnJson } from '../types.js';

async function loadTurnSummariesForQuest(dir: string, questNumber: number): Promise<TurnJson[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const prefix = `turn_${questNumber}_`;
  const matches = entries.filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  const loaded: TurnJson[] = [];

  for (const f of matches) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      loaded.push(JSON.parse(raw) as TurnJson);
    } catch {
      // Skip unreadable / partially-written files; next run may pick them up.
    }
  }

  // Chronological order: by proposal round, then speaking order.
  loaded.sort((a, b) => a.roundIndex - b.roundIndex || a.turnIndex - b.turnIndex);
  return loaded;
}

export interface QuestSynthesisContext {
  /** The game's folder. */
  dir: string;
  gameId: string;
  questNumber: number;
  playerNames: Map<string, string>;
}

export async function synthesizeQuest(
  llm: LLMClient,
  reads: GameReads,
  ctx: QuestSynthesisContext
): Promise<QuestJson | null> {
  const structured = await reads.questData(ctx.questNumber, ctx.playerNames);
  const turns = await loadTurnSummariesForQuest(ctx.dir, ctx.questNumber);

  // Reduce to just the summary + minimal context to keep the prompt focused.
  const turnSummaries = turns.map((t) => ({
    round_index: t.roundIndex,
    turn_index: t.turnIndex,
    speaker: t.speakerDisplayName,
    duration_sec: t.durationSec,
    transcript_excerpt: t.transcript.slice(0, 600), // short excerpt for grounding
    summary: t.summary ?? null,
  }));

  const synthesis = await llm.runJson<QuestSynthesis>('quest-synthesizer.yml', {
    quest_number: ctx.questNumber,
    quest_data: JSON.stringify(structured, null, 2),
    turn_summaries: JSON.stringify(turnSummaries, null, 2),
  });

  const out: QuestJson = {
    ...synthesis,
    quest_number: ctx.questNumber, // enforce in case LLM omits
    gameId: ctx.gameId,
    completedAt: new Date().toISOString(),
  };

  await writeJsonAtomic(questPath(ctx.dir, ctx.questNumber), out);
  return out;
}
