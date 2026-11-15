/**
 * Streamed speech (voice/streams.ts): sentences from a stream, and the first
 * of several tries to give a sentence. No model is called.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PENDING, drained, firstSentence, joined, sentenceStream, settled, type SentenceSource } from '../src/voice/streams.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* chunks(parts: string[], everyMs = 0): AsyncGenerator<string> {
  for (const p of parts) {
    if (everyMs) await sleep(everyMs);
    yield p;
  }
}

async function all<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

test('sentences come out as soon as they are complete, the tail at the end', async () => {
  const got = await all(sentenceStream(chunks(['سلام بچه', '‌ها. من این تیم', ' رو رد می‌کنم! چرا؟ ', 'چون\nآخرش'])));
  assert.deepEqual(got, ['سلام بچه‌ها.', 'من این تیم رو رد می‌کنم!', 'چرا؟', 'چون', 'آخرش']);
});

/** A try that gives `sentences` after `delayMs`, or fails, and notes when it was stopped. */
function source(sentences: string[] | 'fail', delayMs: number, log: string[], name: string): SentenceSource {
  return (signal) =>
    (async function* () {
      log.push(`${name} start`);
      signal.addEventListener('abort', () => log.push(`${name} stopped`));
      await sleep(delayMs);
      if (signal.aborted) throw new Error('aborted');
      if (sentences === 'fail') throw new Error('failed');
      for (const s of sentences) yield s;
    })();
}

test('a slow try is hedged by a second one; the first to give a sentence wins and the other stops', async () => {
  const log: string[] = [];
  const s = await firstSentence(
    [
      { afterMs: 0, source: source(['slow'], 200, log, 'A') },
      { afterMs: 30, source: source(['fast', 'more'], 20, log, 'B') },
    ],
    1000
  );
  assert.ok(s);
  assert.equal(s.index, 1);
  assert.deepEqual(await all(joined(s)), ['fast', 'more']);
  assert.ok(log.includes('A stopped'));
});

test('a failed try is replaced at once, without waiting for its hedge time', async () => {
  const log: string[] = [];
  const started = Date.now();
  const s = await firstSentence(
    [
      { afterMs: 0, source: source('fail', 5, log, 'A') },
      { afterMs: 500, source: source(['ok'], 5, log, 'B') },
    ],
    1000
  );
  assert.equal(s?.first, 'ok');
  assert.ok(Date.now() - started < 200);
});

test('null when every try fails, or none gives a sentence in time', async () => {
  const log: string[] = [];
  assert.equal(await firstSentence([{ afterMs: 0, source: source('fail', 5, log, 'A') }], 500), null);
  assert.equal(await firstSentence([{ afterMs: 0, source: source(['late'], 300, log, 'B') }], 50), null);
  assert.ok(log.includes('B stopped'));
});

test('stopping the winner early stops its stream', async () => {
  const log: string[] = [];
  const s = await firstSentence([{ afterMs: 0, source: source(['one', 'two', 'three'], 5, log, 'A') }], 500);
  assert.ok(s);
  for await (const x of joined(s)) if (x === 'one') break;
  assert.ok(log.includes('A stopped'));
});

test('settled gives a settled value at once, and PENDING otherwise', async () => {
  assert.equal(await settled(Promise.resolve('x')), 'x');
  assert.equal(await settled(Promise.resolve(null)), null);
  assert.equal(await settled(new Promise(() => {})), PENDING);
});

test('a drained stream keeps its words even when the call is stopped after they came', async () => {
  const log: string[] = [];
  const s = await firstSentence([{ afterMs: 0, source: source(['one', 'two', 'three'], 5, log, 'A') }], 500);
  assert.ok(s);
  const d = drained(s);
  await sleep(20); // the rest arrives before anyone plays it
  assert.deepEqual(await all(joined(d)), ['one', 'two', 'three']);
});
