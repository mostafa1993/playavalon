/**
 * Polls Supabase for active games with AI review enabled.
 * Emits start/end callbacks to a single subscriber.
 *
 * Single-concurrent-game assumption (one game at a time on the platform);
 * this watcher therefore tracks one "current session" at a time. A newer
 * active game showing up mid-session means the current one was abandoned
 * (its ended_at never set), so the watcher moves on to the newer game.
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
  // Games already ended or abandoned, so a zombie that still looks active
  // (until the cleanup cron ends it) isn't picked up again.
  const done = new Set<string>();
  let stopped = false;
  let inFlight = false;

  const endCurrent = async () => {
    if (!currentGameId) return;
    const id = currentGameId;
    currentGameId = null;
    done.add(id);
    await callbacks.onGameEnd(id);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      if (currentGameId) {
        // Session active — check if this game has ended.
        const ended = await hasGameEnded(db, currentGameId).catch(() => false);
        if (ended) await endCurrent();
      }

      // Newest active game. If it isn't ours, ours was abandoned — switch.
      // Commit currentGameId only after the start callback succeeds;
      // otherwise we'd get stuck with a "current" session that never
      // actually started, and next tick wouldn't retry.
      const active = await findActiveReviewGame(db);
      if (active && active.id !== currentGameId && !done.has(active.id)) {
        await endCurrent();
        try {
          await callbacks.onGameStart(active);
          currentGameId = active.id;
        } catch (err) {
          console.error('[watcher] onGameStart failed, will retry next tick:', err);
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
