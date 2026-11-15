import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_TALK_WAIT_MS, STOPPED_MS, voteReady } from '../src/brains/voteTiming.ts';
import { TalkClock } from '../src/voice/talkClock.ts';

function clockAt() {
  let t = 1_000_000;
  const clock = new TalkClock(() => t);
  return { clock, at: (ms: number) => (t = ms), now: () => t };
}

test('everyone else has voted: ready at once', () => {
  assert.equal(voteReady({ now: 0, proposalSeenAt: 0, votesCast: 6, others: 6, clock: null }), true);
});

test('a round runs after the proposal: not ready while it runs, ready once it has stopped', () => {
  const { clock, at, now } = clockAt();
  const seen = now();
  at(seen + 10_000); clock.onState(true);           // the round starts
  at(seen + 300_000); clock.onState(true);          // still running, turns advancing
  assert.equal(voteReady({ now: now(), proposalSeenAt: seen, votesCast: 2, others: 6, clock }), false);
  at(seen + 500_000); clock.onState(false);         // the last speaker's time is up
  at(seen + 500_000 + STOPPED_MS - 1);
  assert.equal(voteReady({ now: now(), proposalSeenAt: seen, votesCast: 2, others: 6, clock }), false);
  at(seen + 500_000 + STOPPED_MS);
  assert.equal(voteReady({ now: now(), proposalSeenAt: seen, votesCast: 2, others: 6, clock }), true);
});

test('a round from before the proposal does not count', () => {
  const { clock, at, now } = clockAt();
  clock.onState(true);
  at(now() + 60_000); clock.onState(false);         // the previous round ended
  const seen = now() + 1_000; at(seen);
  assert.equal(voteReady({ now: now(), proposalSeenAt: seen, votesCast: 0, others: 6, clock }), false);
  at(seen + NO_TALK_WAIT_MS);
  assert.equal(voteReady({ now: now(), proposalSeenAt: seen, votesCast: 0, others: 6, clock }), true);
});

test('no timer at all: ready once the no-talk wait has passed', () => {
  assert.equal(voteReady({ now: NO_TALK_WAIT_MS - 1, proposalSeenAt: 0, votesCast: 0, others: 4, clock: null }), false);
  assert.equal(voteReady({ now: NO_TALK_WAIT_MS, proposalSeenAt: 0, votesCast: 0, others: 4, clock: null }), true);
});
