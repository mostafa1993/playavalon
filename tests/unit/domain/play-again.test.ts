import { describe, it, expect } from 'vitest';
import {
  MOVE_WINDOW_MS,
  joinRefusalMessage,
  nextRoomAction,
  type NextRoomActionInput,
} from '@/lib/domain/play-again';
import { ERROR_CODES } from '@/lib/utils/constants';

/** A screen that saw the game end a minute ago, with a waiting next room it isn't in */
const base: NextRoomActionInput = {
  sawGameEnd: true,
  msSinceGameEnd: 60_000,
  moveTried: false,
  seenAsMember: false,
  nextRoomStatus: 'waiting',
  isMember: false,
};

describe('nextRoomAction', () => {
  it('moves a screen that saw the game end, as soon as the next room is there', () => {
    expect(nextRoomAction(base)).toBe('move');
  });

  it('does nothing while there is no next room', () => {
    expect(nextRoomAction({ ...base, nextRoomStatus: null })).toBe('none');
  });

  it('does nothing for a player already in the next room', () => {
    expect(nextRoomAction({ ...base, isMember: true })).toBe('none');
    expect(nextRoomAction({ ...base, sawGameEnd: false, isMember: true })).toBe('none');
  });

  it('never moves a player it once saw in the next room, after they leave it', () => {
    // Joined from another tab, then left: this tab offers the button, no move.
    expect(nextRoomAction({ ...base, seenAsMember: true })).toBe('offer_join');
  });

  it('does nothing once the next room is no longer waiting', () => {
    for (const status of ['roles_distributed', 'started', 'closed'] as const) {
      expect(nextRoomAction({ ...base, nextRoomStatus: status })).toBe('none');
      expect(nextRoomAction({ ...base, nextRoomStatus: status, sawGameEnd: false })).toBe('none');
    }
  });

  it('does not retry a move: after a refusal it offers the join button', () => {
    expect(nextRoomAction({ ...base, moveTried: true })).toBe('offer_join');
  });

  it('never moves a page opened after the game ended; it offers the join button', () => {
    expect(nextRoomAction({ ...base, sawGameEnd: false })).toBe('offer_join');
  });

  it('moves only within 10 minutes of the end', () => {
    expect(nextRoomAction({ ...base, msSinceGameEnd: MOVE_WINDOW_MS - 1 })).toBe('move');
    expect(nextRoomAction({ ...base, msSinceGameEnd: MOVE_WINDOW_MS })).toBe('offer_join');
    expect(nextRoomAction({ ...base, msSinceGameEnd: 60 * 60 * 1000 })).toBe('offer_join');
  });

  it('does not move when the end time is not known', () => {
    expect(nextRoomAction({ ...base, msSinceGameEnd: null })).toBe('offer_join');
  });

  it('is 10 minutes', () => {
    expect(MOVE_WINDOW_MS).toBe(600_000);
  });
});

describe('joinRefusalMessage', () => {
  it('names each refusal of the join route', () => {
    expect(joinRefusalMessage(ERROR_CODES.PLAYER_ALREADY_IN_ROOM)).toBe("You're already in another room");
    expect(joinRefusalMessage(ERROR_CODES.ROOM_FULL)).toBe('The next game is full');
    expect(joinRefusalMessage(ERROR_CODES.ROOM_NOT_WAITING)).toBe('The next game has already started');
  });

  it('falls back to a general message', () => {
    expect(joinRefusalMessage(undefined)).toBe('Could not join the next game');
    expect(joinRefusalMessage(ERROR_CODES.ROOM_NOT_FOUND)).toBe('Could not join the next game');
  });
});
