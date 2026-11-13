/**
 * Play again: what a finished game's screen does about the next room
 * (pure functions).
 *
 * A screen that saw the game end moves its player into the next room as soon
 * as it sees one, within 10 minutes of the end, and tries once. A page opened
 * after the end (a reload, the report's Back button, a new tab) never moves
 * anyone: it offers a "Join next game" button instead. Both happen only while
 * the next room is waiting for players.
 */

import { ERROR_CODES } from '@/lib/utils/constants';
import type { RoomStatus } from '@/types/database';

/** A screen moves its player only this soon after the game ended */
export const MOVE_WINDOW_MS = 10 * 60 * 1000;

export type NextRoomAction = 'move' | 'offer_join' | 'none';

export interface NextRoomActionInput {
  /** This page saw the game in play, then saw it end */
  sawGameEnd: boolean;
  /** How long ago the game ended, or null when not known */
  msSinceGameEnd: number | null;
  /** This page already tried to move its player (joined or refused) */
  moveTried: boolean;
  /** The next room's status, or null while there is no next room */
  nextRoomStatus: RoomStatus | null;
  /** Whether the player is in the next room */
  isMember: boolean;
}

/**
 * Move the player into the next room, offer a button to join it, or nothing
 */
export function nextRoomAction(input: NextRoomActionInput): NextRoomAction {
  if (input.nextRoomStatus !== 'waiting' || input.isMember) {
    return 'none';
  }

  const endedRecently = input.msSinceGameEnd !== null && input.msSinceGameEnd < MOVE_WINDOW_MS;
  if (input.sawGameEnd && endedRecently && !input.moveTried) {
    return 'move';
  }

  return 'offer_join';
}

/**
 * What to tell a player the join route refused, by its error code
 */
export function joinRefusalMessage(code: string | undefined): string {
  switch (code) {
    case ERROR_CODES.PLAYER_ALREADY_IN_ROOM:
      return "You're already in another room";
    case ERROR_CODES.ROOM_FULL:
      return 'The next game is full';
    case ERROR_CODES.ROOM_NOT_WAITING:
      return 'The next game has already started';
    default:
      return 'Could not join the next game';
  }
}
