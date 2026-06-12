/**
 * TimerListener regression tests — focused on the intro-round handling, which
 * shares the core quest/round state machine with every reviewed game.
 *
 * The contract:
 *   - intro turns (isIntro=true) are filed under effective quest 0,
 *   - the first real proposal (isIntro=false) is quest 1 (no collision),
 *   - the completed intro round fires onRoundChanged (the detective's opening read),
 *   - a non-intro game never produces a quest-0 round.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TimerListener } from '@avalon/shared';
import type { SpeakingTimerState } from '../src/types.js';

function encode(state: Partial<SpeakingTimerState>): Uint8Array {
  const full: SpeakingTimerState = {
    speakingOrder: ['L', 'p2', 'L'],
    currentSpeakerIndex: 0,
    timerRunning: true,
    timerStartTime: 1,
    timerDuration: 50,
    questNumber: 1,
    ...state,
  };
  return new TextEncoder().encode(JSON.stringify(full));
}

interface SetCall {
  questNumber: number;
  roundIndex: number;
  turnIndex: number;
}

function makeListener() {
  const setCalls: SetCall[] = [];
  const roundChanges: Array<[number, number]> = [];
  const segmenter = {
    setActiveSpeaker: (t: SetCall) => setCalls.push(t),
    clearActiveSpeaker: () => {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tl = new TimerListener(
    segmenter as any,
    { displayName: (id: string) => id },
    () => {},
    (q, r) => roundChanges.push([q, r])
  );
  return { tl, setCalls, roundChanges };
}

test('intro turns file under quest 0; the first proposal is quest 1 (no collision)', () => {
  const { tl, setCalls, roundChanges } = makeListener();

  // Intro round: questNumber=1 but isIntro=true → effective quest 0.
  tl.onPayload(encode({ currentSpeakerIndex: 0, isIntro: true }));
  assert.equal(setCalls.at(-1)?.questNumber, 0, 'intro turn 0 should be filed under quest 0');
  tl.onPayload(encode({ currentSpeakerIndex: 1, isIntro: true }));
  assert.equal(setCalls.at(-1)?.questNumber, 0, 'intro turn 1 should be filed under quest 0');

  // Intro ends → first proposal (isIntro=false, fresh order, still questNumber 1).
  tl.onPayload(encode({ currentSpeakerIndex: 0, isIntro: false }));
  assert.equal(setCalls.at(-1)?.questNumber, 1, 'first proposal should be quest 1, NOT 0');

  // The completed intro round (quest 0) fired onRoundChanged → the opening guess.
  assert.ok(
    roundChanges.some(([q]) => q === 0),
    'the intro round (quest 0) should fire onRoundChanged'
  );
});

test('a non-intro game files turns under the real quest and never produces a quest-0 round', () => {
  const { tl, setCalls, roundChanges } = makeListener();

  tl.onPayload(encode({ currentSpeakerIndex: 0, questNumber: 1 })); // no isIntro
  assert.equal(setCalls.at(-1)?.questNumber, 1);
  tl.onPayload(encode({ currentSpeakerIndex: 1, questNumber: 1 }));
  assert.equal(setCalls.at(-1)?.questNumber, 1);

  assert.ok(!roundChanges.some(([q]) => q === 0), 'no quest-0 round in a non-intro game');
});
