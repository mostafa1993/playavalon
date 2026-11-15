/**
 * When a bot Assassin names Merlin: after the evil players' discussion.
 *
 * The host may start a 2-minute discussion when the assassin phase begins;
 * the bot waits for it to end, and a little more for its last words to be
 * transcribed and relayed. If no discussion starts, it waits NO_DISCUSSION_MS;
 * it never waits more than MAX_WAIT_MS in all.
 */

import type { TalkClock } from '../voice/talkClock.js';

export const AFTER_DISCUSSION_MS = 10_000;
export const NO_DISCUSSION_MS = 45_000;
export const MAX_WAIT_MS = 180_000;

export function assassinReady(input: { now: number; phaseSeenAt: number; discussion: TalkClock | null }): boolean {
  const waited = input.now - input.phaseSeenAt;
  if (waited >= MAX_WAIT_MS) return true;
  const clock = input.discussion;
  if (clock?.ranSince(input.phaseSeenAt)) return clock.stoppedFor(AFTER_DISCUSSION_MS);
  return waited >= NO_DISCUSSION_MS;
}
