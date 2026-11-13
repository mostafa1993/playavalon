/**
 * Path conventions for per-game review data on disk.
 * Live, a game's folder is <DATA_DIR>/<gameId> (DATA_DIR defaults to
 * /data/games); a replay uses a run folder of its own. Every step reads and
 * writes inside the game's folder:
 *
 *   <dir>/meta.json
 *   <dir>/turn_<quest>_<round>_<idx>.json
 *   <dir>/dossier_<playerIdentity>.json
 *   <dir>/quest_<n>.json
 *   <dir>/discussion.json                 (the assassin-phase discussion)
 *   <dir>/guess_log.json                  (blind mode)
 *   <dir>/record.json                     (the game record)
 *   <dir>/summary.fa.json
 *   <dir>/summary.en.json
 *
 * The <round> segment is the proposal-round-within-quest counter: each
 * proposal's round of talk gets its own files (currentSpeakerIndex resets to 0
 * on every leader rotation).
 */

import path from 'node:path';

export function gameDir(dataDir: string, gameId: string): string {
  return path.join(dataDir, gameId);
}

export function metaPath(dir: string): string {
  return path.join(dir, 'meta.json');
}

export function turnPath(
  dir: string,
  questNumber: number,
  roundIndex: number,
  turnIndex: number
): string {
  return path.join(dir, `turn_${questNumber}_${roundIndex}_${turnIndex}.json`);
}

export function dossierPath(dir: string, playerId: string): string {
  return path.join(dir, `dossier_${playerId}.json`);
}

export function questPath(dir: string, questNumber: number): string {
  return path.join(dir, `quest_${questNumber}.json`);
}

export function summaryPath(dir: string, language: 'fa' | 'en'): string {
  return path.join(dir, `summary.${language}.json`);
}

export function discussionPath(dir: string): string {
  return path.join(dir, 'discussion.json');
}

/** The game record: every fact of the game, written at game end. */
export function recordPath(dir: string): string {
  return path.join(dir, 'record.json');
}

/** Blind-mode incremental role-guess memory (written each round of talk). */
export function guessLogPath(dir: string): string {
  return path.join(dir, 'guess_log.json');
}
