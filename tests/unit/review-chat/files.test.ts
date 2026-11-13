/**
 * Unit tests: the review chat reads the reviewer's files only inside the
 * game's own folder in DATA_DIR — its record.json and the report its review
 * row points at — with symlinks resolved before the check.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gameFilePath, readGameRecord, readSummaryFile } from '@/lib/review-chat/files';
import { godRecord } from './fixtures';

let base: string;
let dataDir: string;
const GAME = 'game-1';

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'review-chat-')));
  dataDir = path.join(base, 'games');
  const game = path.join(dataDir, GAME);
  await fs.mkdir(game, { recursive: true });
  await fs.writeFile(path.join(game, 'record.json'), JSON.stringify(godRecord));
  await fs.writeFile(path.join(game, 'summary.fa.json'), '{"format":2}');
  // Another game's report, and a record just outside DATA_DIR.
  await fs.mkdir(path.join(dataDir, 'game-2'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'game-2', 'summary.fa.json'), '{"format":2}');
  await fs.mkdir(path.join(base, 'outside'), { recursive: true });
  await fs.writeFile(path.join(base, 'outside', 'record.json'), JSON.stringify(godRecord));
  // A sibling folder whose name starts with the game's.
  await fs.mkdir(path.join(dataDir, `${GAME}-other`), { recursive: true });
  await fs.writeFile(path.join(dataDir, `${GAME}-other`, 'summary.fa.json'), '{}');

  // Symlinks inside the game's folders: to a file outside DATA_DIR, to another
  // game's folder, and to a file of its own.
  await fs.symlink(path.join(base, 'outside', 'record.json'), path.join(game, 'summary.en.json'));
  await fs.symlink(path.join(dataDir, 'game-2'), path.join(game, 'linked'));
  await fs.symlink(path.join(game, 'summary.fa.json'), path.join(game, 'summary.link.json'));
  const linkedGame = path.join(dataDir, 'game-4');
  await fs.mkdir(linkedGame);
  await fs.symlink(path.join(base, 'outside', 'record.json'), path.join(linkedGame, 'record.json'));
  // A game folder that is itself a link out of DATA_DIR.
  await fs.symlink(path.join(base, 'outside'), path.join(dataDir, 'game-5'));
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('gameFilePath', () => {
  it('resolves a file of the game’s folder, given relative to DATA_DIR or absolute', async () => {
    const file = path.join(dataDir, GAME, 'record.json');
    expect(await gameFilePath(dataDir, GAME, `${GAME}/record.json`)).toBe(file);
    expect(await gameFilePath(dataDir, GAME, file)).toBe(file);
    expect(await gameFilePath(path.relative(process.cwd(), dataDir), GAME, file)).toBe(file);
  });

  it('is null for a file that doesn’t exist', async () => {
    expect(await gameFilePath(dataDir, GAME, `${GAME}/summary.de.json`)).toBeNull();
  });

  it('refuses a path outside the game’s folder', async () => {
    for (const target of [
      '../outside/record.json',
      '/etc/passwd',
      'game-2/summary.fa.json',
      `${GAME}-other/summary.fa.json`,
      GAME,
    ]) {
      await expect(gameFilePath(dataDir, GAME, target), target).rejects.toThrow(/outside the game/);
    }
  });

  it('refuses a game id that is not one folder of DATA_DIR', async () => {
    for (const gameId of ['..', '.', '../outside', 'game-1/linked']) {
      await expect(gameFilePath(dataDir, gameId, `${gameId}/record.json`), gameId).rejects.toThrow(
        /outside the game/
      );
    }
  });

  it('refuses a symlink that leads out of the game’s folder', async () => {
    await expect(gameFilePath(dataDir, GAME, `${GAME}/summary.en.json`)).rejects.toThrow(/leads outside/);
    await expect(gameFilePath(dataDir, GAME, `${GAME}/linked/summary.fa.json`)).rejects.toThrow(
      /leads outside/
    );
    await expect(gameFilePath(dataDir, 'game-5', 'game-5/record.json')).rejects.toThrow(/leads outside/);
  });

  it('follows a symlink that stays inside the game’s folder', async () => {
    expect(await gameFilePath(dataDir, GAME, `${GAME}/summary.link.json`)).toBe(
      path.join(dataDir, GAME, 'summary.fa.json')
    );
  });
});

describe('readGameRecord', () => {
  it('reads a game folder’s record', async () => {
    expect(await readGameRecord(dataDir, GAME)).toEqual(godRecord);
  });

  it('is null when the reviewer left no record', async () => {
    expect(await readGameRecord(dataDir, 'game-2')).toBeNull();
  });

  it('refuses a game id that leaves DATA_DIR, even to a real record', async () => {
    await expect(readGameRecord(dataDir, '../outside')).rejects.toThrow(/outside/);
  });

  it('refuses a record that is a symlink out of DATA_DIR', async () => {
    await expect(readGameRecord(dataDir, 'game-4')).rejects.toThrow(/leads outside/);
  });

  it('refuses a file that is not a record', async () => {
    await fs.mkdir(path.join(dataDir, 'game-3'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'game-3', 'record.json'), '{"mode":"god"}');
    await expect(readGameRecord(dataDir, 'game-3')).rejects.toThrow(/Not a game record/);
  });
});

describe('readSummaryFile', () => {
  it('reads the game’s report its review row points at', async () => {
    expect(await readSummaryFile(dataDir, GAME, path.join(dataDir, GAME, 'summary.fa.json'))).toEqual({
      format: 2,
    });
  });

  it('is null when the file is gone', async () => {
    expect(await readSummaryFile(dataDir, GAME, path.join(dataDir, GAME, 'summary.de.json'))).toBeNull();
  });

  it('refuses another game’s report, and a path outside DATA_DIR', async () => {
    await expect(
      readSummaryFile(dataDir, GAME, path.join(dataDir, 'game-2', 'summary.fa.json'))
    ).rejects.toThrow(/outside the game/);
    await expect(readSummaryFile(dataDir, GAME, path.join(base, 'outside', 'record.json'))).rejects.toThrow(
      /outside/
    );
  });
});
