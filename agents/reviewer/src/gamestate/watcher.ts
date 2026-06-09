/**
 * Polls Supabase for active games with AI review enabled.
 * Emits start/end callbacks to a single subscriber.
 *
 * Single-concurrent-game assumption (one game at a time on the platform);
 * this watcher therefore tracks one "current session" at a time.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActiveGameRow } from './db.js';
import { findActiveReviewGame, hasGameEnded } from './db.js';

export interface WatcherCallbacks {
  onGameStart: (game: ActiveGameRow) => Promise<void> | void;
  onGameEnd: (gameId: string) => Promise<void> | void;
}

export interface Watcher {
  stop: () => void;
}

export function startWatcher(
  db: SupabaseClient,
  intervalMs: number,
  callbacks: WatcherCallbacks
): Watcher {
  let currentGameId: string | null = null;
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      if (currentGameId) {
        // Session active — check if this game has ended.
        const ended = await hasGameEnded(db, currentGameId).catch(() => false);
        if (ended) {
          const id = currentGameId;
          currentGameId = null;
          await callbacks.onGameEnd(id);
        }
      }

      if (!currentGameId) {
        // Look for a new active game. Commit currentGameId only after the
        // start callback succeeds; otherwise we'd get stuck with a "current"
        // session that never actually started, and next tick wouldn't retry.
        const active = await findActiveReviewGame(db);
        if (active) {
          try {
            await callbacks.onGameStart(active);
            currentGameId = active.id;
          } catch (err) {
            console.error('[watcher] onGameStart failed, will retry next tick:', err);
          }
        }
      }
    } catch (err) {
      console.error('[watcher] tick failed:', err);
    } finally {
      inFlight = false;
    }
  };

  // Fire once immediately, then on interval.
  void tick();
  const handle = setInterval(() => { void tick(); }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
