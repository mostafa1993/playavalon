/**
 * Which statement a bot says when its speaking slot opens, so that it starts
 * talking at once: the prepared statement if it is ready (or comes within the
 * grace); otherwise the quick one, written as a backup when the bot was next
 * up, or now — whichever of the two is ready first.
 */

export const PENDING = Symbol('pending');

/** The value of a promise that has already settled, or PENDING; it never waits. */
export async function settled<T>(promise: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([promise, Promise.resolve(PENDING)]);
}

export interface Picked {
  text: string | null;
  /** 'prepared': ready at the slot or within the grace; 'quick': the backup or one written now. */
  from: 'prepared' | 'quick';
  /** Whether the slot found the prepared statement not ready (the quick one was in the running). */
  raced: boolean;
}

/**
 * `prepared` and `backup` resolve to text, or null when writing failed; they
 * never reject. `quick` writes a quick statement now; it is called only when
 * there is no backup and the prepared statement isn't ready.
 */
export async function pickStatement(
  prepared: Promise<string | null>,
  backup: Promise<string | null> | undefined,
  quick: () => Promise<string | null>,
  graceMs: number
): Promise<Picked> {
  const ready = await settled(prepared);
  if (typeof ready === 'string') return { text: ready, from: 'prepared', raced: false };
  const fast = backup ?? quick();
  if (ready === null) return { text: await fast, from: 'quick', raced: false };

  const soon = await Promise.race([prepared, new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING), graceMs))]);
  if (typeof soon === 'string') return { text: soon, from: 'prepared', raced: false };

  const first = await Promise.race([
    prepared.then((text) => ({ text, from: 'prepared' as const })),
    fast.then((text) => ({ text, from: 'quick' as const })),
  ]);
  if (first.text) return { ...first, raced: true };
  // The first one failed: the other one, whenever it comes.
  return first.from === 'prepared'
    ? { text: await fast, from: 'quick', raced: true }
    : { text: await prepared, from: 'prepared', raced: true };
}
