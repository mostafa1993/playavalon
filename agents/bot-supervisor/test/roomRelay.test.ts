import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRelay, type ToBot } from '../src/supervisor/roomRelay.ts';

function peer() {
  const got: ToBot[] = [];
  return { got, send: (m: ToBot) => got.push(m) };
}

const texts = (got: ToBot[]) => got.map((m) => ('text' in m ? m.text : m.type));

test('what the ears hear goes to every bot of the room', () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromEars({ type: 'turn', quest: 1, round: 0, turnIndex: 2, speaker: 'Reza', text: 'سلام' });
  assert.equal(a.got.length, 1);
  assert.equal(b.got.length, 1);
});

test("a bot's own words go to the other bots, not back to it", () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromBot('bot_alice', { type: 'said', quest: 1, round: 0, turnIndex: 1, speaker: 'Alice', text: 'من رای مثبت میدم' });
  assert.deepEqual(a.got, []);
  assert.deepEqual(b.got, [{ type: 'turn', quest: 1, round: 0, turnIndex: 1, speaker: 'Alice', text: 'من رای مثبت میدم' }]);
});

test('a bot that (re)starts gets everything heard so far, once it is ready; "talking" is not kept', () => {
  const relay = new RoomRelay();
  relay.fromEars({ type: 'turn', quest: 1, round: 0, turnIndex: 0, speaker: 'Reza', text: 'یک' });
  relay.fromBot('bot_bob', { type: 'said', quest: 1, round: 0, turnIndex: 1, speaker: 'Bob', text: 'دو' });
  relay.fromEars({ type: 'talking', speaker: 'Nima' });
  relay.fromEars({ type: 'discussion', speaker: 'Nima', text: 'سه', fromBot: false });
  const a = peer();
  relay.addBot('bot_alice', a);
  assert.deepEqual(a.got, []);
  relay.fromBot('bot_alice', { type: 'ready' });
  assert.deepEqual(texts(a.got), ['یک', 'دو', 'سه']);
});

test("a bot's words in the assassin discussion reach the others as a bot's discussion line", () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromBot('bot_alice', { type: 'discussed', speaker: 'Alice', text: 'مینا مرلینه' });
  assert.deepEqual(a.got, []);
  assert.deepEqual(b.got, [{ type: 'discussion', speaker: 'Alice', text: 'مینا مرلینه', fromBot: true }]);
});

test('the floor goes to one bot at a time, in the order asked', () => {
  const relay = new RoomRelay();
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromBot('bot_alice', { type: 'floor-request' });
  relay.fromBot('bot_bob', { type: 'floor-request' });
  relay.fromBot('bot_bob', { type: 'floor-request' });
  assert.equal(relay.floor, 'bot_alice');
  assert.deepEqual(texts(a.got), ['floor']);
  assert.deepEqual(b.got, []);
  relay.fromBot('bot_bob', { type: 'floor-release' }); // not its floor: nothing
  assert.equal(relay.floor, 'bot_alice');
  relay.fromBot('bot_alice', { type: 'floor-release' });
  assert.equal(relay.floor, 'bot_bob');
  assert.deepEqual(texts(b.got), ['floor']);
  relay.fromBot('bot_bob', { type: 'floor-release' });
  assert.equal(relay.floor, null);
});

test('a bot that leaves, or keeps the floor too long, loses it', async () => {
  const relay = new RoomRelay(30);
  const a = peer(), b = peer();
  relay.addBot('bot_alice', a);
  relay.addBot('bot_bob', b);
  relay.fromBot('bot_alice', { type: 'floor-request' });
  relay.fromBot('bot_bob', { type: 'floor-request' });
  relay.removeBot('bot_alice');
  assert.equal(relay.floor, 'bot_bob');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(relay.floor, null);
});
