/**
 * Which statement a bot says when its slot opens (voice/pickStatement.ts).
 * No model is called: statements are promises that resolve after a delay.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PENDING, pickStatement, settled } from '../src/voice/pickStatement.js';

const after = (ms: number, text: string | null) => new Promise<string | null>((r) => setTimeout(() => r(text), ms));
const never = () => new Promise<string | null>(() => {});
const noQuick = () => {
  throw new Error('quick written when it was not needed');
};

test('settled gives a settled value at once, and PENDING otherwise', async () => {
  assert.equal(await settled(Promise.resolve('x')), 'x');
  assert.equal(await settled(Promise.resolve(null)), null);
  assert.equal(await settled(never()), PENDING);
});

test('a prepared statement that is ready is said, and nothing quick is written', async () => {
  const prepared = Promise.resolve('prepared');
  await prepared;
  assert.deepEqual(await pickStatement(prepared, undefined, noQuick, 50), { text: 'prepared', from: 'prepared', raced: false });
});

test('a prepared statement that comes within the grace beats a ready backup', async () => {
  const picked = await pickStatement(after(10, 'prepared'), Promise.resolve('backup'), noQuick, 50);
  assert.deepEqual(picked, { text: 'prepared', from: 'prepared', raced: false });
});

test('not ready: the backup written when next up is said right after the grace', async () => {
  const started = Date.now();
  const picked = await pickStatement(never(), Promise.resolve('backup'), noQuick, 30);
  assert.deepEqual(picked, { text: 'backup', from: 'quick', raced: true });
  assert.ok(Date.now() - started < 200);
});

test('not ready and no backup: a quick one is written at once, and the first to come is said', async () => {
  let quickCalls = 0;
  const quick = () => {
    quickCalls += 1;
    return after(20, 'quick');
  };
  assert.deepEqual(await pickStatement(after(200, 'prepared'), undefined, quick, 5), { text: 'quick', from: 'quick', raced: true });
  assert.equal(quickCalls, 1);
  assert.deepEqual(await pickStatement(after(30, 'prepared'), undefined, () => after(200, 'quick'), 5), { text: 'prepared', from: 'prepared', raced: true });
});

test('a failed prepared statement falls to the quick one; both failing says nothing', async () => {
  const failed = Promise.resolve(null);
  await failed;
  assert.deepEqual(await pickStatement(failed, Promise.resolve('backup'), noQuick, 5), { text: 'backup', from: 'quick', raced: false });
  assert.deepEqual(await pickStatement(after(10, null), after(30, 'backup'), noQuick, 5), { text: 'backup', from: 'quick', raced: true });
  assert.equal((await pickStatement(after(10, null), Promise.resolve(null), noQuick, 5)).text, null);
});
