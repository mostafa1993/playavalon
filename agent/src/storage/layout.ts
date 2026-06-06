/**
 * Path conventions for per-game review data on disk.
 * Base dir is configured via DATA_DIR (default /data/games).
 *
 *   <dataDir>/<gameId>/meta.json
 *   <dataDir>/<gameId>/turn_<quest>_<round>_<idx>.json
 *   <dataDir>/<gameId>/dossier_<playerIdentity>.json   (M3+)
 *   <dataDir>/<gameId>/quest_<n>.json                  (M3+)
 *   <dataDir>/<gameId>/summary.fa.json                 (M4+)
 *   <dataDir>/<gameId>/summary.en.json                 (M4+)
 *
 * The <round> segment is the proposal-round-within-quest counter and was
 * added to fix the bug where a rejected proposal's discussion was
 * overwritten by the next round's discussion (currentSpeakerIndex resets
 * to 0 on every leader rotation, so the old `turn_<q>_<idx>` scheme
 * collided). Old data files (3-segment names) are still readable; the
 * questSynthesizer prefix-match `turn_<q>_` matches both naming schemes.
 */

import path from 'node:path';

export function gameDir(dataDir: string, gameId: string): string {
  return path.join(dataDir, gameId);
}

export function metaPath(dataDir: string, gameId: string): string {
  return path.join(gameDir(dataDir, gameId), 'meta.json');
}

export function turnPath(
  dataDir: string,
  gameId: string,
  questNumber: number,
  roundIndex: number,
  turnIndex: number
): string {
  return path.join(
    gameDir(dataDir, gameId),
    `turn_${questNumber}_${roundIndex}_${turnIndex}.json`
  );
}

export function dossierPath(dataDir: string, gameId: string, playerId: string): string {
  return path.join(gameDir(dataDir, gameId), `dossier_${playerId}.json`);
}

export function questPath(dataDir: string, gameId: string, questNumber: number): string {
  return path.join(gameDir(dataDir, gameId), `quest_${questNumber}.json`);
}

export function summaryPath(
  dataDir: string,
  gameId: string,
  language: 'fa' | 'en'
): string {
  return path.join(gameDir(dataDir, gameId), `summary.${language}.json`);
}

export function discussionPath(dataDir: string, gameId: string): string {
  return path.join(gameDir(dataDir, gameId), 'discussion.json');
}
