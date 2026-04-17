/**
 * Watcher Session Management
 * Feature 015: In-memory session tracking for spectators
 *
 * CRITICAL DESIGN DECISIONS:
 * - All data is ephemeral (in-memory Map) per NFR-004, NFR-006
 * - No database writes for watcher operations per SC-009, SC-010
 * - Server restart clears all sessions (watchers simply rejoin)
 */

import type { WatcherInfo, WatcherSessionStore } from '@/types/watcher';
import {
  MAX_WATCHERS_PER_GAME,
  WATCHER_TIMEOUT_SECONDS,
} from '@/types/watcher';

/**
 * Global in-memory storage for all watcher sessions
 * Key: gameId, Value: Map<userId, WatcherInfo>
 */
const watcherSessions: WatcherSessionStore = new Map();

/**
 * Add a watcher to a game session
 */
export function addWatcher(
  gameId: string,
  userId: string,
  displayName: string
): boolean {
  cleanupStaleWatchers(gameId);

  let gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    gameWatchers = new Map();
    watcherSessions.set(gameId, gameWatchers);
  }

  // Rejoin case
  if (gameWatchers.has(userId)) {
    const existing = gameWatchers.get(userId)!;
    existing.lastSeen = Date.now();
    existing.display_name = displayName;
    return true;
  }

  if (gameWatchers.size >= MAX_WATCHERS_PER_GAME) {
    return false;
  }

  const now = Date.now();
  gameWatchers.set(userId, {
    userId,
    display_name: displayName,
    joinedAt: now,
    lastSeen: now,
  });

  return true;
}

/**
 * Remove a watcher from a game session
 */
export function removeWatcher(gameId: string, userId: string): boolean {
  const gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    return false;
  }

  const removed = gameWatchers.delete(userId);

  if (gameWatchers.size === 0) {
    watcherSessions.delete(gameId);
  }

  return removed;
}

/**
 * Get the current watcher count for a game
 */
export function getWatcherCount(gameId: string): number {
  cleanupStaleWatchers(gameId);

  const gameWatchers = watcherSessions.get(gameId);
  return gameWatchers?.size ?? 0;
}

/**
 * Check if the watcher limit has been reached for a game
 */
export function isWatcherLimitReached(gameId: string): boolean {
  return getWatcherCount(gameId) >= MAX_WATCHERS_PER_GAME;
}

/**
 * Update a watcher's last seen timestamp
 */
export function updateWatcherLastSeen(
  gameId: string,
  userId: string
): boolean {
  const gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    return false;
  }

  const watcher = gameWatchers.get(userId);
  if (!watcher) {
    return false;
  }

  watcher.lastSeen = Date.now();
  return true;
}

/**
 * Clean up stale watcher sessions (30-second timeout)
 */
export function cleanupStaleWatchers(gameId: string): number {
  const gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    return 0;
  }

  const now = Date.now();
  const timeoutMs = WATCHER_TIMEOUT_SECONDS * 1000;
  let removedCount = 0;

  for (const [userId, watcher] of gameWatchers) {
    if (now - watcher.lastSeen > timeoutMs) {
      gameWatchers.delete(userId);
      removedCount++;
    }
  }

  if (gameWatchers.size === 0) {
    watcherSessions.delete(gameId);
  }

  return removedCount;
}

/**
 * Check if a user is currently a watcher for a game
 */
export function isWatcher(gameId: string, userId: string): boolean {
  cleanupStaleWatchers(gameId);

  const gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    return false;
  }

  return gameWatchers.has(userId);
}

/**
 * Get watcher info for a specific user
 */
export function getWatcher(
  gameId: string,
  userId: string
): WatcherInfo | null {
  const gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    return null;
  }

  return gameWatchers.get(userId) ?? null;
}

/**
 * Get all watchers for a game
 */
export function getWatchers(gameId: string): WatcherInfo[] {
  cleanupStaleWatchers(gameId);

  const gameWatchers = watcherSessions.get(gameId);
  if (!gameWatchers) {
    return [];
  }

  return Array.from(gameWatchers.values());
}

/**
 * Clear all watchers for a game
 */
export function clearGameWatchers(gameId: string): void {
  watcherSessions.delete(gameId);
}

/**
 * Get the total number of active watcher sessions across all games
 */
export function getTotalWatcherCount(): number {
  let total = 0;
  for (const [gameId] of watcherSessions) {
    total += getWatcherCount(gameId);
  }
  return total;
}

/**
 * Get the number of games with active watchers
 */
export function getActiveWatchedGamesCount(): number {
  for (const [gameId] of watcherSessions) {
    cleanupStaleWatchers(gameId);
  }
  return watcherSessions.size;
}
