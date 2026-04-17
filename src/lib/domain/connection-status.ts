/**
 * Connection status domain logic
 *
 * Pure functions for computing player connection status
 * from last_activity_at timestamp.
 */

import type { ConnectionStatus } from '@/types/player';

/** Seconds of inactivity before player is marked as disconnected */
export const DISCONNECT_AFTER_SECONDS = 60;

/** Client heartbeat interval in seconds */
export const HEARTBEAT_INTERVAL_SECONDS = 30;

/**
 * Compute connection status from last activity timestamp
 */
export function getConnectionStatus(lastActivityAt: string | Date): ConnectionStatus {
  const lastActivity = typeof lastActivityAt === 'string'
    ? new Date(lastActivityAt)
    : lastActivityAt;

  const now = new Date();
  const secondsSince = Math.floor((now.getTime() - lastActivity.getTime()) / 1000);

  const isConnected = secondsSince < DISCONNECT_AFTER_SECONDS;

  return {
    is_connected: isConnected,
    seconds_since_activity: Math.max(0, secondsSince),
  };
}

/**
 * Check if a player is currently connected (has recent activity)
 */
export function isPlayerConnected(lastActivityAt: string | Date): boolean {
  const status = getConnectionStatus(lastActivityAt);
  return status.is_connected;
}
