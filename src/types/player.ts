/**
 * Player types (post-auth-migration)
 */

// ============================================
// CONNECTION STATUS
// ============================================

/**
 * Connection status computed from last_activity_at
 * Not stored in database - calculated on each request
 */
export interface ConnectionStatus {
  /** True if player has activity within last 60 seconds */
  is_connected: boolean;
  /** Seconds since last heartbeat/activity */
  seconds_since_activity: number;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

/** POST /api/players/heartbeat - Response */
export interface HeartbeatResponse {
  success: boolean;
  timestamp?: string;
  error?: 'UNAUTHORIZED' | 'PLAYER_NOT_FOUND';
}

// ============================================
// PLAYER INFO WITH CONNECTION STATUS
// ============================================

/**
 * Player info including computed connection status
 * Used in room/game responses
 */
export interface PlayerWithConnectionStatus {
  id: string;
  display_name: string;
  is_manager?: boolean;
  is_connected: boolean;
  seconds_since_activity: number;
  joined_at?: string;
  seat_position?: number;
}
