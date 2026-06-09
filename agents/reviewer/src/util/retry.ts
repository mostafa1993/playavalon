/**
 * Exponential backoff with jitter.
 *
 * Retries a function up to `maxAttempts - 1` times when `shouldRetry` returns
 * true for the thrown error. Waits `baseDelayMs * 2^attempt` plus a small
 * random jitter between attempts.
 */

export interface RetryOptions {
  maxAttempts?: number;       // total attempts including the first; default 3
  baseDelayMs?: number;       // default 500
  maxDelayMs?: number;        // cap per-attempt delay; default 10_000
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  // Clamp to at least one attempt so the function always runs once; otherwise
  // we'd throw the unset `lastErr` for a caller that set maxAttempts=0.
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 10_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts - 1 || !shouldRetry(err)) {
        throw err;
      }
      const expDelay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.floor(Math.random() * Math.min(baseDelayMs, expDelay));
      const delay = Math.min(expDelay + jitter, maxDelayMs);
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
  // Unreachable: maxAttempts ≥ 1 means the loop either returns or throws.
  throw new Error('retry() exited loop without resolving');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** True for status codes that typically warrant a retry. */
export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/** Heuristic: Node's fetch throws TypeError for network failures. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_SOCKET' // undici socket error
  );
}
