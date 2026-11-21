import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBots } from '../src/supervisor/pickBots.ts';

const smart = (name: string) => ({ username: `bot_${name}`, smart: true });
const rule = (name: string) => ({ username: `bot_${name}`, smart: false });
const POOL = [smart('parisa'), smart('koorosh'), smart('dariush'), smart('mandana'), rule('erin'), rule('fiona')];
const names = (bots: { username: string }[]) => bots.map((b) => b.username.slice(4));

test('one bot is any of the four smart bots, each about as often', () => {
  const count = new Map<string, number>();
  for (let i = 0; i < 4000; i += 1) {
    const [bot] = pickBots(POOL, 1, new Set());
    count.set(bot!.username, (count.get(bot!.username) ?? 0) + 1);
  }
  assert.deepEqual([...count.keys()].sort(), ['bot_dariush', 'bot_koorosh', 'bot_mandana', 'bot_parisa']);
  for (const n of count.values()) assert.ok(n > 800 && n < 1200, `uneven: ${[...count]}`);
});

test('the smart bots come before the rule bots, which keep their order', () => {
  const six = pickBots(POOL, 6, new Set());
  assert.deepEqual(names(six).slice(0, 4).sort(), ['dariush', 'koorosh', 'mandana', 'parisa']);
  assert.deepEqual(names(six).slice(4), ['erin', 'fiona']);
  assert.equal(pickBots(POOL, 9, new Set()).length, 6);
  assert.deepEqual(pickBots(POOL, 0, new Set()), []);
});

test('a smart bot running for another room comes after the free ones', () => {
  const busy = new Set(['bot_parisa', 'bot_koorosh', 'bot_dariush']);
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(names(pickBots(POOL, 1, busy)), ['mandana']);
    assert.deepEqual(names(pickBots(POOL, 4, busy)).slice(0, 1), ['mandana']);
    assert.deepEqual(names(pickBots(POOL, 4, busy)).slice(1).sort(), ['dariush', 'koorosh', 'parisa']);
  }
});
