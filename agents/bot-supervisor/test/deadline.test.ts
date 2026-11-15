import test from 'node:test';
import assert from 'node:assert/strict';
import { raceWithDeadline } from '../src/brains/deadline.ts';

const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const failAfter = (ms: number) => new Promise<never>((_, j) => setTimeout(() => j(new Error('boom')), ms));

test('the primary in time wins', async () => {
  assert.deepEqual(await raceWithDeadline(after(10, 'carbon'), after(5, 'hydrogen'), 50), { value: 'carbon', from: 'primary' });
});

test('past the deadline, the fallback', async () => {
  const t = Date.now();
  assert.deepEqual(await raceWithDeadline(after(200, 'carbon'), after(5, 'hydrogen'), 30), { value: 'hydrogen', from: 'fallback' });
  assert.ok(Date.now() - t < 150);
});

test('a primary that fails gives the fallback, without waiting for the deadline', async () => {
  const t = Date.now();
  assert.deepEqual(await raceWithDeadline(failAfter(5), after(10, 'hydrogen'), 500), { value: 'hydrogen', from: 'fallback' });
  assert.ok(Date.now() - t < 200);
});

test('a fallback that fails waits for the primary, late', async () => {
  assert.deepEqual(await raceWithDeadline(after(60, 'carbon'), failAfter(5), 20), { value: 'carbon', from: 'primary' });
});

test('both failing throws', async () => {
  await assert.rejects(raceWithDeadline(failAfter(5), failAfter(5), 20), /boom/);
});
