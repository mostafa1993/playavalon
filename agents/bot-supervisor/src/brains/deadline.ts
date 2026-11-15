/**
 * Carbon's answer if it comes in time, Hydrogen's otherwise. Gemini 4 Carbon on
 * HIGH has taken from 36 s to 5 minutes for one move; the table won't wait the
 * worst of that. Both calls start together; the primary's answer is used if it
 * arrives before the deadline; otherwise the fallback's (waited for if it isn't
 * in yet). If the fallback fails, the primary's answer is waited for, late; if
 * both fail, the primary's error is thrown.
 */

export async function raceWithDeadline<T>(
  primary: Promise<T>,
  fallback: Promise<T>,
  deadlineMs: number
): Promise<{ value: T; from: 'primary' | 'fallback' }> {
  primary.catch(() => {});
  fallback.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), deadlineMs);
  });
  try {
    const first = await Promise.race([primary.then((v) => ({ v }), () => 'failed' as const), late]);
    if (first !== 'late' && first !== 'failed') return { value: first.v, from: 'primary' };
  } finally {
    clearTimeout(timer);
  }
  try {
    return { value: await fallback, from: 'fallback' };
  } catch {
    return { value: await primary, from: 'primary' };
  }
}
