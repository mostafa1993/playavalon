/**
 * Input validation utilities (pure functions)
 * Used for validating user input across API routes
 */

import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
} from '@/lib/utils/constants';

/**
 * Validation result type
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate player count for room creation
 * - Must be between 5 and 10
 */
export function validatePlayerCount(count: number): ValidationResult {
  if (typeof count !== 'number' || isNaN(count)) {
    return { valid: false, error: 'Player count must be a number' };
  }

  if (!Number.isInteger(count)) {
    return { valid: false, error: 'Player count must be a whole number' };
  }

  if (count < MIN_PLAYERS) {
    return { valid: false, error: `Minimum ${MIN_PLAYERS} players required` };
  }

  if (count > MAX_PLAYERS) {
    return { valid: false, error: `Maximum ${MAX_PLAYERS} players allowed` };
  }

  return { valid: true };
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string): ValidationResult {
  if (!uuid || typeof uuid !== 'string') {
    return { valid: false, error: 'UUID is required' };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    return { valid: false, error: 'Invalid UUID format' };
  }

  return { valid: true };
}

/**
 * Validate room code format
 * - Must be exactly 6 characters
 * - Only valid characters allowed
 */
export function validateRoomCode(code: string): ValidationResult {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Room code is required' };
  }

  const normalized = code.trim().toUpperCase();

  if (normalized.length !== ROOM_CODE_LENGTH) {
    return { valid: false, error: `Room code must be ${ROOM_CODE_LENGTH} characters` };
  }

  // Valid characters (excluding easily confused ones)
  const validChars = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;
  if (!validChars.test(normalized)) {
    return { valid: false, error: 'Room code contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Check if a room is full
 */
export function isRoomFull(currentPlayers: number, expectedPlayers: number): boolean {
  return currentPlayers >= expectedPlayers;
}

/**
 * Check if a room can accept more players
 */
export function canJoinRoom(
  roomStatus: string,
  currentPlayers: number,
  expectedPlayers: number
): ValidationResult {
  if (roomStatus !== 'waiting') {
    return { valid: false, error: 'Room is not accepting new players' };
  }

  if (isRoomFull(currentPlayers, expectedPlayers)) {
    return { valid: false, error: 'Room is full' };
  }

  return { valid: true };
}

/**
 * Check if roles can be distributed
 */
export function canDistributeRoles(
  roomStatus: string,
  currentPlayers: number,
  expectedPlayers: number,
  isManager: boolean
): ValidationResult {
  if (!isManager) {
    return { valid: false, error: 'Only the room manager can distribute roles' };
  }

  if (roomStatus !== 'waiting') {
    return { valid: false, error: 'Roles have already been distributed' };
  }

  if (currentPlayers !== expectedPlayers) {
    return { valid: false, error: 'All players must be present to distribute roles' };
  }

  return { valid: true };
}

/**
 * Check if game can be started
 */
export function canStartGame(
  roomStatus: string,
  allConfirmed: boolean,
  isManager: boolean
): ValidationResult {
  if (!isManager) {
    return { valid: false, error: 'Only the room manager can start the game' };
  }

  if (roomStatus !== 'roles_distributed') {
    return { valid: false, error: 'Roles must be distributed before starting' };
  }

  if (!allConfirmed) {
    return { valid: false, error: 'All players must confirm their roles' };
  }

  return { valid: true };
}
