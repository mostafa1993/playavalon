/**
 * Final narrative — runs once per language at game end.
 * Takes: game meta, outcome, per-player dossiers, per-quest syntheses.
 * Produces: long-form prose narrative of the whole game.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { LLMClient } from './llm.js';
import { discussionPath, gameDir } from '../storage/layout.js';
import type {
  DiscussionJson,
  DossierJson,
  GameMetaSnapshot,
  QuestJson,
} from '../types.js';
import type { GameOutcome } from '../gamestate/db.js';

/** Load every quest_<n>.json for a game, ordered by quest number. */
export async function loadAllQuestJsons(
  dataDir: string,
  gameId: string
): Promise<QuestJson[]> {
  const dir = gameDir(dataDir, gameId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const matches = entries.filter(
    (f) => /^quest_\d+\.json$/.test(f)
  );
  const loaded: QuestJson[] = [];
  for (const f of matches) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      loaded.push(JSON.parse(raw) as QuestJson);
    } catch {
      // Skip unreadable files; they'll just be missing from the narrative.
    }
  }
  loaded.sort((a, b) => a.quest_number - b.quest_number);
  return loaded;
}

/** Load every dossier_<playerId>.json for a game. */
export async function loadAllDossiers(
  dataDir: string,
  gameId: string
): Promise<DossierJson[]> {
  const dir = gameDir(dataDir, gameId);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const matches = entries.filter((f) => /^dossier_.+\.json$/.test(f));
  const loaded: DossierJson[] = [];
  for (const f of matches) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      loaded.push(JSON.parse(raw) as DossierJson);
    } catch {
      // Skip unreadable files.
    }
  }
  // Deterministic order so repeated narrative generations produce the same input.
  loaded.sort((a, b) => a.playerId.localeCompare(b.playerId));
  return loaded;
}

/**
 * Load the discussion.json file if present. Returns null when the game
 * didn't reach the assassin phase or the manager never started a discussion
 * timer — both are valid and the narrative prompt handles that case.
 */
export async function loadDiscussion(
  dataDir: string,
  gameId: string
): Promise<DiscussionJson | null> {
  try {
    const raw = await fs.readFile(discussionPath(dataDir, gameId), 'utf8');
    return JSON.parse(raw) as DiscussionJson;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface FinalNarrativeContext {
  meta: GameMetaSnapshot;
  outcome: GameOutcome;
  dossiers: DossierJson[];
  quests: QuestJson[];
  discussion: DiscussionJson | null;
}

export async function generateFinalNarrative(
  llm: LLMClient,
  ctx: FinalNarrativeContext,
  language: 'fa' | 'en'
): Promise<string> {
  const promptFile =
    language === 'fa' ? 'final-narrative-fa.yml' : 'final-narrative-en.yml';

  // Keep meta + outcome compact; no need for raw dossiers in full if they're
  // huge, but at typical sizes they fit comfortably.
  const metaForPrompt = {
    gameId: ctx.meta.gameId,
    roomCode: ctx.meta.roomCode,
    playerCount: ctx.meta.playerCount,
    startedAt: ctx.meta.startedAt,
    players: ctx.meta.players.map((p) => ({
      display_name: p.display_name,
      seat_number: p.seat_number,
      role: p.role,
      special_role: p.special_role,
    })),
  };

  // For the prompt, strip the large raw PCM-metadata fields (sampleRate,
  // confidence) down to what actually helps the narrative.
  const discussionForPrompt = ctx.discussion
    ? {
        startedAt: ctx.discussion.startedAt,
        durationSec: ctx.discussion.durationSec,
        assassinDisplayName: ctx.discussion.assassinDisplayName,
        speakers: ctx.discussion.speakers
          .filter((s) => s.transcript.trim().length > 0)
          .map((s) => ({
            display_name: s.display_name,
            durationSec: s.durationSec,
            transcript: s.transcript,
            summary: s.summary,
          })),
      }
    : null;

  return llm.runText(promptFile, {
    meta: JSON.stringify(metaForPrompt, null, 2),
    outcome: JSON.stringify(ctx.outcome, null, 2),
    dossiers: JSON.stringify(ctx.dossiers, null, 2),
    quests: JSON.stringify(ctx.quests, null, 2),
    discussion: JSON.stringify(discussionForPrompt, null, 2),
  });
}
