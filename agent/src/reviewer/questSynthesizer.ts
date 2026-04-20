/**
 * Quest synthesizer — runs once per quest, after the quest's last turn
 * has been transcribed + summarized.
 *
 * Pulls:
 *   - all turn JSONs for the quest from disk (for per-turn summaries)
 *   - proposals, votes, mission result from Supabase (structured)
 *
 * Writes: quest_<n>.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LLMClient } from './llm.js';
import { loadQuestStructuredData } from '../gamestate/db.js';
import { writeJsonAtomic } from '../storage/atomicWrite.js';
import { gameDir, questPath } from '../storage/layout.js';
import type { QuestJson, QuestSynthesis, TurnJson } from '../types.js';

async function loadTurnSummariesForQuest(
  dataDir: string,
  gameId: string,
  questNumber: number
): Promise<TurnJson[]> {
  const dir = gameDir(dataDir, gameId);
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

  loaded.sort((a, b) => a.turnIndex - b.turnIndex);
  return loaded;
}

export interface QuestSynthesisContext {
  dataDir: string;
  gameId: string;
  questNumber: number;
  playerNames: Map<string, string>;
}

export async function synthesizeQuest(
  llm: LLMClient,
  db: SupabaseClient,
  ctx: QuestSynthesisContext
): Promise<QuestJson | null> {
  const structured = await loadQuestStructuredData(
    db,
    ctx.gameId,
    ctx.questNumber,
    ctx.playerNames
  );
  const turns = await loadTurnSummariesForQuest(ctx.dataDir, ctx.gameId, ctx.questNumber);

  // Reduce to just the summary + minimal context to keep the prompt focused.
  const turnSummaries = turns.map((t) => ({
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

  await writeJsonAtomic(questPath(ctx.dataDir, ctx.gameId, ctx.questNumber), out);
  return out;
}
