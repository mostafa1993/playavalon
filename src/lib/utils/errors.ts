/**
 * Error handling utilities for API responses
 */

import { NextResponse } from 'next/server';
import { ERROR_CODES, type ErrorCode } from './constants';

/**
 * API Error class with code and HTTP status
 */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Error response shape
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number = 400,
  details?: unknown
): NextResponse<ErrorResponse> {
  const errorObj: { code: string; message: string; details?: unknown } = {
    code,
    message,
  };

  if (details !== undefined) {
    errorObj.details = details;
  }

  return NextResponse.json(
    { error: errorObj },
    { status }
  );
}

/**
 * Common error responses
 */
export const errors = {
  unauthorized: (message = 'Authentication required') =>
    errorResponse(ERROR_CODES.UNAUTHORIZED, message, 401),

  notFound: (resource = 'Resource') =>
    errorResponse(ERROR_CODES.NOT_FOUND, `${resource} not found`, 404),

  invalidRequest: (message = 'Invalid request body') =>
    errorResponse(ERROR_CODES.INVALID_REQUEST, message, 400),

  internalError: (message = 'An unexpected error occurred') =>
    errorResponse(ERROR_CODES.INTERNAL_ERROR, message, 500),

  playerNotFound: () =>
    errorResponse(ERROR_CODES.PLAYER_NOT_FOUND, 'Player profile not found', 404),

  invalidPlayerCount: () =>
    errorResponse(ERROR_CODES.INVALID_PLAYER_COUNT, 'Player count must be 5-10', 400),

  playerAlreadyInRoom: () =>
    errorResponse(ERROR_CODES.PLAYER_ALREADY_IN_ROOM, 'Player is already in a room', 409),

  roomNotFound: () =>
    errorResponse(ERROR_CODES.ROOM_NOT_FOUND, 'Room not found', 404),

  roomFull: () =>
    errorResponse(ERROR_CODES.ROOM_FULL, 'Room is full', 409),

  roomNotWaiting: () =>
    errorResponse(ERROR_CODES.ROOM_NOT_WAITING, 'Room is not accepting players', 409),

  notRoomMember: () =>
    errorResponse(ERROR_CODES.NOT_ROOM_MEMBER, 'You are not a member of this room', 403),

  notRoomManager: () =>
    errorResponse(ERROR_CODES.NOT_ROOM_MANAGER, 'Only the room manager can perform this action', 403),

  roomNotFull: () =>
    errorResponse(ERROR_CODES.ROOM_NOT_FULL, 'Room must be full to distribute roles', 409),

  rolesAlreadyDistributed: () =>
    errorResponse(ERROR_CODES.ROLES_ALREADY_DISTRIBUTED, 'Roles have already been distributed', 409),

  rolesNotDistributed: () =>
    errorResponse(ERROR_CODES.ROLES_NOT_DISTRIBUTED, 'Roles have not been distributed yet', 409),

  alreadyConfirmed: () =>
    errorResponse(ERROR_CODES.ALREADY_CONFIRMED, 'Role already confirmed', 409),

  notAllConfirmed: () =>
    errorResponse(ERROR_CODES.NOT_ALL_CONFIRMED, 'All players must confirm their roles', 409),

  alreadyStarted: () =>
    errorResponse(ERROR_CODES.ALREADY_STARTED, 'Game has already started', 409),

  aiConsentRequired: (missing: number) =>
    errorResponse(
      ERROR_CODES.AI_CONSENT_REQUIRED,
      `AI Game Review is enabled but ${missing} player(s) have not consented. Ask them to accept or toggle the feature off.`,
      412
    ),
};

/**
 * Handle unknown errors and convert to ApiError
 */
export function handleError(error: unknown): NextResponse<ErrorResponse> {
  if (error instanceof ApiError) {
    return errorResponse(error.code, error.message, error.status, error.details);
  }

  console.error('Unhandled error:', error);
  return errors.internalError();
}
