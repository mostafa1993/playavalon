/** The round a speaking turn is filed under: as the host states it, so a listener that (re)joins mid-quest agrees. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TimerListener, type ActiveSpeaker, type TurnSink } from '@avalon/shared';

function listener() {
  const seen: ActiveSpeaker[] = [];
  const sink: TurnSink = { setActiveSpeaker: (s) => seen.push(s), clearActiveSpeaker: () => {} };
  return { timer: new TimerListener(sink, { displayName: (id) => id }), seen };
}
const state = (o: Record<string, unknown>) =>
  new TextEncoder().encode(JSON.stringify({ speakingOrder: ['lead', 'p2'], currentSpeakerIndex: 1, timerRunning: true, timerStartTime: 1, timerDuration: 50, questNumber: 3, ...o }));

test('a listener that joins mid-quest files turns under the round the host states', () => {
  const { timer, seen } = listener();
  timer.onPayload(state({ round: 2 }));
  assert.equal(seen[0].roundIndex, 2);
  assert.equal(timer.getCurrentRoundIndex(), 2);
});

test('without a stated round, rounds are counted by leader changes, as before', () => {
  const { timer, seen } = listener();
  timer.onPayload(state({}));
  timer.onPayload(state({ speakingOrder: ['next', 'p2'], currentSpeakerIndex: 0 }));
  assert.deepEqual(seen.map((s) => s.roundIndex), [0, 1]);
});
