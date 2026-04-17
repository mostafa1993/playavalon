/**
 * Database types for Supabase tables
 * Auto-generated from data-model.md schema
 * Updated for Phase 2: Special Roles & Configurations
 * Updated for Phase 6: Player Recovery & Reconnection
 */

import type { RoleConfig } from './role-config';

export interface Database {
  public: {
    Tables: {
      players: {
        Row: {
          id: string;                  // Equals auth.users.id
          username: string;            // Unique, lowercase
          display_name: string;        // Cosmetic, shown in UI
          last_activity_at: string;    // Heartbeat timestamp for disconnect detection
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;                  // Must match auth.users.id
          username: string;
          display_name: string;
          last_activity_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          last_activity_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      rooms: {
        Row: {
          id: string;
          code: string;
          manager_id: string;
          expected_players: number;
          status: RoomStatus;
          created_at: string;
          last_activity_at: string;
          // Phase 2 additions
          role_config: RoleConfig;
          lady_of_lake_enabled: boolean;
          lady_of_lake_holder_id: string | null;
        };
        Insert: {
          id?: string;
          code: string;
          manager_id: string;
          expected_players: number;
          status?: RoomStatus;
          created_at?: string;
          last_activity_at?: string;
          // Phase 2 additions
          role_config?: RoleConfig;
          lady_of_lake_enabled?: boolean;
          lady_of_lake_holder_id?: string | null;
        };
        Update: {
          id?: string;
          code?: string;
          manager_id?: string;
          expected_players?: number;
          status?: RoomStatus;
          created_at?: string;
          last_activity_at?: string;
          // Phase 2 additions
          role_config?: RoleConfig;
          lady_of_lake_enabled?: boolean;
          lady_of_lake_holder_id?: string | null;
        };
      };
      room_players: {
        Row: {
          id: string;
          room_id: string;
          player_id: string;
          joined_at: string;
          is_connected: boolean;
          disconnected_at: string | null;
        };
        Insert: {
          id?: string;
          room_id: string;
          player_id: string;
          joined_at?: string;
          is_connected?: boolean;
          disconnected_at?: string | null;
        };
        Update: {
          id?: string;
          room_id?: string;
          player_id?: string;
          joined_at?: string;
          is_connected?: boolean;
          disconnected_at?: string | null;
        };
      };
      player_roles: {
        Row: {
          id: string;
          room_id: string;
          player_id: string;
          role: Role;
          special_role: SpecialRole;
          is_confirmed: boolean;
          assigned_at: string;
          // Phase 2 addition
          has_lady_of_lake: boolean;
        };
        Insert: {
          id?: string;
          room_id: string;
          player_id: string;
          role: Role;
          special_role: SpecialRole;
          is_confirmed?: boolean;
          assigned_at?: string;
          // Phase 2 addition
          has_lady_of_lake?: boolean;
        };
        Update: {
          id?: string;
          room_id?: string;
          player_id?: string;
          role?: Role;
          special_role?: SpecialRole;
          is_confirmed?: boolean;
          assigned_at?: string;
          // Phase 2 addition
          has_lady_of_lake?: boolean;
        };
      };
    };
    Functions: {
      get_evil_teammates: {
        Args: { p_room_id: string; p_player_id: string };
        Returns: Array<{ display_name: string }>;
      };
      archive_stale_rooms: {
        Args: Record<string, never>;
        Returns: Array<{
          archived_waiting: number;
          archived_roles_distributed: number;
          archived_started: number;
          total_archived: number;
        }>;
      };
      check_username_available: {
        Args: { p_username: string };
        Returns: boolean;
      };
    };
  };
}

// Room status enum
// 'closed' = archived room (inactive but preserved for statistics)
export type RoomStatus = 'waiting' | 'roles_distributed' | 'started' | 'closed';

// Role enum (base alignment)
export type Role = 'good' | 'evil';

// Special role enum (specific characters)
// Phase 2: Split oberon into oberon_standard and oberon_chaos
// Feature 020: Added lunatic and brute from Big Box expansion
export type SpecialRole =
  | 'merlin'          // Good - knows evil players (except Mordred, Oberon Chaos)
  | 'percival'        // Good - knows Merlin (but Morgana looks the same)
  | 'servant'         // Good - basic loyal servant
  | 'assassin'        // Evil - can assassinate Merlin at end
  | 'morgana'         // Evil - appears as Merlin to Percival
  | 'mordred'         // Evil - hidden from Merlin
  | 'oberon_standard' // Evil - visible to Merlin, hidden from evil team
  | 'oberon_chaos'    // Evil - hidden from everyone including Merlin
  | 'minion'          // Evil - basic minion
  | 'lunatic'         // Evil - MUST fail every quest (Big Box)
  | 'brute';          // Evil - can only fail quests 1-3 (Big Box)

// Convenience types from row types
export type Player = Database['public']['Tables']['players']['Row'];
export type PlayerInsert = Database['public']['Tables']['players']['Insert'];
export type PlayerUpdate = Database['public']['Tables']['players']['Update'];

export type Room = Database['public']['Tables']['rooms']['Row'];
export type RoomInsert = Database['public']['Tables']['rooms']['Insert'];
export type RoomUpdate = Database['public']['Tables']['rooms']['Update'];

export type RoomPlayer = Database['public']['Tables']['room_players']['Row'];
export type RoomPlayerInsert = Database['public']['Tables']['room_players']['Insert'];
export type RoomPlayerUpdate = Database['public']['Tables']['room_players']['Update'];

export type PlayerRole = Database['public']['Tables']['player_roles']['Row'];
export type PlayerRoleInsert = Database['public']['Tables']['player_roles']['Insert'];
export type PlayerRoleUpdate = Database['public']['Tables']['player_roles']['Update'];
