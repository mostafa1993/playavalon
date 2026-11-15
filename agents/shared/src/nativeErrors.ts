/**
 * LiveKit's native layer (@livekit/rtc-node) sometimes throws, outside any of
 * our calls, while it cleans up its own handles: "trying to drop an invalid
 * handle", "handle not found". Uncaught, they end the process; the room keeps
 * working after them. A smart bot or a room's ears that died on one would lose
 * its private read and maybe a turn (seen in the local test games).
 *
 * tolerateLiveKitHandleErrors() keeps the process alive on exactly those two
 * errors, logging each, and ends it on anything else, as Node would.
 */

const HANDLE_ERROR = /trying to drop an invalid handle|handle not found/i;

export function isLiveKitHandleError(err: unknown): boolean {
  return err instanceof Error && HANDLE_ERROR.test(err.message);
}

export function tolerateLiveKitHandleErrors(log: { warn: (msg: string) => void; error: (msg: string, err?: unknown) => void }): void {
  process.on('uncaughtException', (err) => {
    if (isLiveKitHandleError(err)) {
      log.warn(`[livekit] native handle error, carrying on: ${err.message}`);
      return;
    }
    log.error('uncaught exception', err);
    process.exit(1);
  });
}
