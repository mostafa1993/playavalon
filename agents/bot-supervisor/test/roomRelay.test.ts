import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRelay, type Heard } from '../src/supervisor/roomRelay.ts';

function peer() {
  const got: Heard[] = [];
  return { got, send: (m: Heard) => got.push(m) };
}

test('what the ears hear goes to every bot of the room', () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromEars({ type: 'turn', quest: 1, round: 0, speaker: 'Reza', text: 'سلام' });
  assert.equal(a.got.length, 1);
  assert.equal(b.got.length, 1);
});

test("a bot's own words go to the other bots, not back to it", () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromBot('bot_alice', { type: 'said', quest: 1, round: 0, speaker: 'Alice', text: 'من رای مثبت میدم' });
  assert.deepEqual(a.got, []);
  assert.deepEqual(b.got, [{ type: 'turn', quest: 1, round: 0, speaker: 'Alice', text: 'من رای مثبت میدم' }]);
});

test('a bot that (re)starts gets everything heard so far, once it is ready', () => {
  const relay = new RoomRelay();
  relay.fromEars({ type: 'turn', quest: 1, round: 0, speaker: 'Reza', text: 'یک' });
  relay.fromBot('bot_bob', { type: 'said', quest: 1, round: 0, speaker: 'Bob', text: 'دو' });
  relay.fromEars({ type: 'discussion', speaker: 'Nima', text: 'سه' });
  const a = peer();
  relay.addBot('bot_alice', a);
  assert.deepEqual(a.got, []);
  relay.fromBot('bot_alice', { type: 'ready' });
  assert.deepEqual(a.got.map((m) => m.text), ['یک', 'دو', 'سه']);
});

test("a bot's words in the assassin discussion reach the others as discussion", () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromBot('bot_alice', { type: 'discussed', speaker: 'Alice', text: 'مینا مرلینه' });
  assert.deepEqual(a.got, []);
  assert.deepEqual(b.got, [{ type: 'discussion', speaker: 'Alice', text: 'مینا مرلینه' }]);
});
