/**
 * Jitter — randomized delay so multiple agents acting on the same phase
 * transition don't fire at literally the same millisecond. Also gives
 * games a "humans pause to think" cadence.
 *
 * All time inputs are milliseconds. Range is [min, max] inclusive.
 */

export function randomDelayMs(min: number, max: number): number {
  if (max <= min) return Math.max(0, min);
  return Math.floor(min + Math.random() * (max - min + 1));
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function jitter(min: number, max: number): Promise<void> {
  await sleep(randomDelayMs(min, max));
}
