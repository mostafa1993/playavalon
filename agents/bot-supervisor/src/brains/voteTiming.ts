/**
 * When a smart bot casts its vote: after the table has talked about the team.
 * In real games the leader proposes, then every player speaks about the team
 * in turn (about ten 50-second turns), then the votes come — a bot that voted
 * at once voted before hearing any of it.
 *
 * Ready when any of:
 *   - every other player has voted (nothing more to wait for);
 *   - a speaking round ran after the proposal and the timer has now stopped
 *     for STOPPED_MS (the round about this team is over);
 *   - no speaking round ran within NO_TALK_WAIT_MS of the proposal (a game
 *     played without the timer, or the bot can't hear the room).
 */

import type { TalkClock } from '../voice/talkClock.js';

export const STOPPED_MS = 5_000;
export const NO_TALK_WAIT_MS = 45_000;

export function voteReady(input: {
  now: number;
  /** When the bot first saw this proposal. */
  proposalSeenAt: number;
  votesCast: number;
  /** Players other than the bot. */
  others: number;
  clock: TalkClock | null;
}): boolean {
  if (input.votesCast >= input.others) return true;
  if (input.clock?.ranSince(input.proposalSeenAt)) return input.clock.stoppedFor(STOPPED_MS);
  return input.now - input.proposalSeenAt >= NO_TALK_WAIT_MS;
}
