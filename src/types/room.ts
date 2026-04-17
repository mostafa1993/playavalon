/**
 * Room-related types for application use
 * Updated for Phase 2: Special Roles & Configurations
 */

import type { Room, RoomStatus } from './database';
import type { RoleConfig } from './role-config';

// Re-export for convenience
export type { RoleConfig } from './role-config';

/**
 * Room with computed properties for display
 */
export interface RoomWithDetails extends Room {
  manager_display_name: string;
  current_players: number;
  is_full: boolean;
}

/**
 * Room list item for active rooms page
 * Feature 015: Added status and current_game_id for watch functionality
 */
export interface RoomListItem {
  id: string;
  code: string;
  manager_display_name: string;
  expected_players: number;
  current_players: number;
  is_full: boolean;
  created_at: string;
  last_activity_at?: string;
  // Feature 015: Watcher mode support
  status: RoomStatus;
  current_game_id: string | null;
}

/**
 * Room details with players for lobby view (extended for Phase 2)
 */
export interface RoomDetails {
  room: Room;
  players: RoomPlayerInfo[];
  current_player: {
    id: string;
    display_name: string;
    is_manager: boolean;
  };
  confirmations?: {
    total: number;
    confirmed: number;
  };
  // Phase 2 additions
  roles_in_play?: string[];
  lady_of_lake_holder?: {
    id: string;
    display_name: string;
  } | null;
}

/**
 * Player info within a room
 * Updated for Phase 6: Connection status computed from last_activity_at
 */
export interface RoomPlayerInfo {
  id: string;
  display_name: string;
  is_manager: boolean;
  is_connected: boolean;
  joined_at: string;
  // Phase 6: Connection status details
  last_activity_at?: string;
  seconds_since_activity?: number;
}

/**
 * Room creation payload (extended for Phase 2)
 */
export interface CreateRoomPayload {
  expected_players: number;
  // Phase 2: Optional role configuration
  role_config?: RoleConfig;
}

/**
 * Room creation response (extended for Phase 2)
 */
export interface CreateRoomResponse {
  id: string;
  code: string;
  manager_id: string;
  expected_players: number;
  status: RoomStatus;
  created_at: string;
  // Phase 2 additions
  role_config: RoleConfig;
  lady_of_lake_enabled: boolean;
  roles_in_play: string[];
}

/**
 * Join room response
 */
export interface JoinRoomResponse {
  room_id: string;
  user_id: string;
  joined_at: string;
  is_rejoin: boolean;
}

/**
 * Leave room response
 */
export interface LeaveRoomResponse {
  left: true;
  room_code: string;
}
