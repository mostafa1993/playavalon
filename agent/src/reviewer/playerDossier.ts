/**
 * Player dossier — evolving long-term memory per player.
 *
 * For each turn, we read the existing dossier (or start a fresh one),
 * run the `dossier-update` prompt against the new turn summary, and
 * atomically write the updated dossier back.
 *
 * The dossier is the primary input the final narrative consumes, so
 * cross-quest coherence matters more than individual turn accuracy.
 */

import fs from 'node:fs/promises';
import type { LLMClient } from './llm.js';
import { writeJsonAtomic } from '../storage/atomicWrite.js';
import { dossierPath } from '../storage/layout.js';
import type { DossierJson, TurnSummary } from '../types.js';

function emptyDossier(playerId: string, playerDisplayName: string): DossierJson {
  return {
    playerId,
    playerDisplayName,
    lastQuestNumber: 0,
    lastTurnIndex: -1,
    updatedAt: new Date().toISOString(),
    behavior_arc: [],
    stated_claims: [],
    contradictions: [],
    alliance_patterns: [],
    key_moments: [],
  };
}

async function readDossier(
  dataDir: string,
  gameId: string,
  playerId: string,
  playerDisplayName: string
): Promise<DossierJson> {
  try {
    const raw = await fs.readFile(dossierPath(dataDir, gameId, playerId), 'utf8');
    const parsed = JSON.parse(raw) as DossierJson;
    // Patch display name if the previous dossier had a stale one.
    if (parsed.playerDisplayName !== playerDisplayName && playerDisplayName) {
      parsed.playerDisplayName = playerDisplayName;
    }
    return parsed;
  } catch (err) {
    // ENOENT or parse error → start fresh.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyDossier(playerId, playerDisplayName);
    }
    throw err;
  }
}

export interface DossierUpdateContext {
  dataDir: string;
  gameId: string;
  playerId: string;
  playerDisplayName: string;
  playerSeat: number | null;
  questNumber: number;
  turnIndex: number;
  turnSummary: TurnSummary;
}

/**
 * Per-player lock chain. Serializes dossier updates for the same player so
 * concurrent processTurn calls can't clobber each other's read-modify-write.
 * Keys are `${gameId}:${playerId}` so locks are scoped to one game.
 */
const locks = new Map<string, Promise<unknown>>();

export async function updateDossier(
  llm: LLMClient,
  ctx: DossierUpdateContext
): Promise<DossierJson> {
  const key = `${ctx.gameId}:${ctx.playerId}`;
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(
    () => doUpdate(llm, ctx),
    () => doUpdate(llm, ctx) // run even if prev failed
  );
  locks.set(key, next);
  try {
    return await next;
  } finally {
    // Only clear if no newer update has taken the slot.
    if (locks.get(key) === next) locks.delete(key);
  }
}

async function doUpdate(
  llm: LLMClient,
  ctx: DossierUpdateContext
): Promise<DossierJson> {
  const previous = await readDossier(
    ctx.dataDir,
    ctx.gameId,
    ctx.playerId,
    ctx.playerDisplayName
  );

  const updated = await llm.runJson<Omit<DossierJson, 'playerId' | 'playerDisplayName' | 'lastQuestNumber' | 'lastTurnIndex' | 'updatedAt'>>(
    'dossier-update.yml',
    {
      player_display_name: ctx.playerDisplayName,
      player_seat: ctx.playerSeat,
      quest_number: ctx.questNumber,
      turn_index: ctx.turnIndex,
      previous_dossier: JSON.stringify(
        {
          behavior_arc: previous.behavior_arc,
          stated_claims: previous.stated_claims,
          contradictions: previous.contradictions,
          alliance_patterns: previous.alliance_patterns,
          key_moments: previous.key_moments,
        },
        null,
        2
      ),
      turn_summary: JSON.stringify(ctx.turnSummary, null, 2),
    }
  );

  const next: DossierJson = {
    playerId: ctx.playerId,
    playerDisplayName: ctx.playerDisplayName,
    lastQuestNumber: ctx.questNumber,
    lastTurnIndex: ctx.turnIndex,
    updatedAt: new Date().toISOString(),
    behavior_arc: Array.isArray(updated.behavior_arc) ? updated.behavior_arc : previous.behavior_arc,
    stated_claims: Array.isArray(updated.stated_claims) ? updated.stated_claims : previous.stated_claims,
    contradictions: Array.isArray(updated.contradictions) ? updated.contradictions : previous.contradictions,
    alliance_patterns: Array.isArray(updated.alliance_patterns) ? updated.alliance_patterns : previous.alliance_patterns,
    key_moments: Array.isArray(updated.key_moments) ? updated.key_moments : previous.key_moments,
  };

  await writeJsonAtomic(dossierPath(ctx.dataDir, ctx.gameId, ctx.playerId), next);
  return next;
}
