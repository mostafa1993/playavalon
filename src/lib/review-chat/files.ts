/**
 * The reviewer's files the chat reads: a game's record
 * (`<DATA_DIR>/<gameId>/record.json`) and its Persian report (the path the
 * review row holds). Each read is confined to the game's own folder in
 * DATA_DIR — the reviewer's volume, mounted read-only into the app — with
 * symlinks resolved first, so no link inside it leads out.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReviewGameRecord } from '@/types/review';

export function reviewDataDir(): string {
  return process.env.DATA_DIR ?? '/data/games';
}

const inside = (folder: string, file: string) => file.startsWith(folder + path.sep);

/**
 * `target` (relative to DATA_DIR, or absolute) as a real path inside
 * `<DATA_DIR>/<gameId>/`, symlinks resolved; null when it doesn't exist.
 * Throws when it lies, or leads, outside that folder.
 */
export async function gameFilePath(
  dataDir: string,
  gameId: string,
  target: string
): Promise<string | null> {
  const root = path.resolve(dataDir);
  const folder = path.resolve(root, gameId);
  const resolved = path.resolve(root, target);
  if (path.dirname(folder) !== root || !inside(folder, resolved)) {
    throw new Error(`Review file outside the game's folder ${folder}: ${target}`);
  }

  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const realFolder = path.join(await fs.realpath(root), path.basename(folder));
  if (!inside(realFolder, real)) {
    throw new Error(`Review file leads outside the game's folder ${folder}: ${target}`);
  }
  return real;
}

/** The parsed file; null when it doesn't exist. */
async function readJson(file: string | null): Promise<unknown | null> {
  if (file === null) return null;
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function isGameRecord(v: unknown): v is ReviewGameRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    (r.mode === 'god' || r.mode === 'blind') &&
    [r.players, r.proposals, r.missions, r.lady, r.turns].every(Array.isArray)
  );
}

/** The game's record; null when the reviewer left none (a game reviewed
 *  before records were written, or one it couldn't rebuild). */
export async function readGameRecord(
  dataDir: string,
  gameId: string
): Promise<ReviewGameRecord | null> {
  const file = await gameFilePath(dataDir, gameId, path.join(gameId, 'record.json'));
  const record = await readJson(file);
  if (record === null) return null;
  if (!isGameRecord(record)) throw new Error(`Not a game record: ${file}`);
  return record;
}

/** A summary file of this game that its review row points at, as written;
 *  null when missing. */
export async function readSummaryFile(
  dataDir: string,
  gameId: string,
  summaryPath: string
): Promise<unknown | null> {
  return readJson(await gameFilePath(dataDir, gameId, summaryPath));
}
