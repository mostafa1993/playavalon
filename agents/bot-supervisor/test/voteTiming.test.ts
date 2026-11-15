import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_TALK_WAIT_MS, STALLED_MS, voteReady } from '../src/brains/voteTiming.ts';
import { TalkClock } from '../src/voice/talkClock.ts';

const ORDER = ['leader', 'b', 'c', 'leader'];

function setup() {
  let t = 1_000_000;
  const clock = new TalkClock(() => t);
  const state = (running: boolean, index: number, order = ORDER) =>
    clock.onState({ timerRunning: running, currentSpeakerIndex: index, speakingOrder: order });
  return { clock, state, at: (ms: number) => (t = ms), now: () => t };
}

const ready = (now: number, seen: number, clock: TalkClock | null, votesCast = 1) =>
  voteReady({ now, proposalSeenAt: seen, votesCast, others: 6, clock });

test('everyone else has voted: ready at once', () => {
  assert.equal(voteReady({ now: 0, proposalSeenAt: 0, votesCast: 6, others: 6, clock: null }), true);
});

test('not ready between speakers; ready once the last speaker is done', () => {
  const { clock, state, at, now } = setup();
  state(false, 0); // the order for this round, generated on the leader change
  const seen = now() + 1_000; at(seen);
  at(seen + 5_000); state(true, 0);   // the leader opens
  at(seen + 55_000); state(false, 1); // auto-advance: stopped until the host starts b
  at(seen + 75_000);                  // 20 s gap between speakers
  assert.equal(ready(now(), seen, clock), false);
  state(true, 1);
  at(seen + 125_000); state(false, 2); at(seen + 130_000); state(true, 2);
  at(seen + 180_000); state(false, 3); at(seen + 185_000); state(true, 3); // the leader closes
  assert.equal(ready(now(), seen, clock), false);
  at(seen + 235_000); state(false, 4); // past the last speaker
  assert.equal(ready(now(), seen, clock), true);
});

test('a round the host stops running: ready after the stall', () => {
  const { clock, state, at, now } = setup();
  state(false, 0);
  const seen = now(); 
  at(seen + 1_000); state(true, 0);
  at(seen + 51_000); state(false, 1);
  at(seen + 51_000 + STALLED_MS - 1);
  assert.equal(ready(now(), seen, clock), false);
  at(seen + 51_000 + STALLED_MS);
  assert.equal(ready(now(), seen, clock), true);
});

test('a round finished before the proposal does not count', () => {
  const { clock, state, at, now } = setup();
  state(true, 3); at(now() + 50_000); state(false, 4); // the previous round ended
  const seen = now() + 1_000; at(seen);
  assert.equal(ready(now(), seen, clock), false);
  at(seen + NO_TALK_WAIT_MS);
  assert.equal(ready(now(), seen, clock), true);
});

test('no timer at all: ready once the no-talk wait has passed', () => {
  assert.equal(ready(NO_TALK_WAIT_MS - 1, 0, null, 0), false);
  assert.equal(ready(NO_TALK_WAIT_MS, 0, null, 0), true);
});
