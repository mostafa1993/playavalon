/**
 * Atomic JSON write: write to <path>.tmp, fsync, then rename.
 * Prevents downstream readers from seeing half-written files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tmp = `${filePath}.tmp`;
  const body = JSON.stringify(data, null, 2);

  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(body, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }

  await fs.rename(tmp, filePath);
}
