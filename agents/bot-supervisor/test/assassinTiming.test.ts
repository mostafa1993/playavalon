import test from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_DISCUSSION_MS, MAX_WAIT_MS, NO_DISCUSSION_MS, assassinReady } from '../src/brains/assassinTiming.ts';
import { TalkClock } from '../src/voice/talkClock.ts';

const run = (clock: TalkClock, running: boolean) => clock.onState({ timerRunning: running, currentSpeakerIndex: 0, speakingOrder: [] });

test('waits out the discussion, then a little more for its last words', () => {
  let t = 1_000_000;
  const clock = new TalkClock(() => t);
  const seen = t;
  t += 5_000; run(clock, true);
  t += 60_000;
  assert.equal(assassinReady({ now: t, phaseSeenAt: seen, discussion: clock }), false);
  t += 60_000; run(clock, false);
  t += AFTER_DISCUSSION_MS - 1;
  assert.equal(assassinReady({ now: t, phaseSeenAt: seen, discussion: clock }), false);
  t += 1;
  assert.equal(assassinReady({ now: t, phaseSeenAt: seen, discussion: clock }), true);
});

test('no discussion: waits a short while; and never more than the cap', () => {
  assert.equal(assassinReady({ now: NO_DISCUSSION_MS - 1, phaseSeenAt: 0, discussion: null }), false);
  assert.equal(assassinReady({ now: NO_DISCUSSION_MS, phaseSeenAt: 0, discussion: null }), true);
  let t = 0;
  const clock = new TalkClock(() => t);
  run(clock, true); // a discussion that never stops
  assert.equal(assassinReady({ now: MAX_WAIT_MS - 1, phaseSeenAt: 0, discussion: clock }), false);
  assert.equal(assassinReady({ now: MAX_WAIT_MS, phaseSeenAt: 0, discussion: clock }), true);
});
