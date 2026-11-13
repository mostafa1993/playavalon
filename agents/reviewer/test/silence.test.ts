import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRms, isSilent, splitAtQuietest, transcribe } from '@avalon/shared';

test('computeRms returns 0 for empty buffer', () => {
  assert.equal(computeRms(new Int16Array(0)), 0);
});

test('computeRms returns 0 for all-zero buffer', () => {
  assert.equal(computeRms(new Int16Array(1000)), 0);
});

test('computeRms returns expected magnitude for constant signal', () => {
  // Constant amplitude 1000 → RMS = 1000 exactly.
  const buf = new Int16Array(1000).fill(1000);
  const rms = computeRms(buf);
  assert.ok(Math.abs(rms - 1000) < 1);
});

test('isSilent is true below threshold, false above', () => {
  const quiet = new Int16Array(1000).fill(50);   // RMS = 50
  const speech = new Int16Array(1000).fill(3000); // RMS = 3000
  assert.equal(isSilent(quiet, 250), true);
  assert.equal(isSilent(speech, 250), false);
});

test('isSilent treats empty buffers as silent', () => {
  assert.equal(isSilent(new Int16Array(0), 250), true);
});

const RATE = 16000;
/** `spec` is a list of [seconds, amplitude]: speech at 3000, silence at 0. */
function clip(spec: Array<[number, number]>): Int16Array {
  const total = spec.reduce((n, [sec]) => n + Math.round(sec * RATE), 0);
  const out = new Int16Array(total);
  let i = 0;
  for (const [sec, amp] of spec) {
    const n = Math.round(sec * RATE);
    // Alternate sign so speech has energy but no DC offset.
    for (let k = 0; k < n; k += 1) out[i + k] = k % 2 === 0 ? amp : -amp;
    i += n;
  }
  return out;
}

test('splitAtQuietest leaves a clip of 55 s or less whole', () => {
  assert.deepEqual(splitAtQuietest(clip([[54, 3000]]), RATE), [{ start: 0, end: 54 * RATE }]);
});

test('splitAtQuietest cuts a 120 s clip into pieces of at most 55 s that cover it, in pauses', () => {
  // Speech with a 1 s pause at 40 s and another at 85 s.
  const pcm = clip([[40, 3000], [1, 0], [44, 3000], [1, 0], [34, 3000]]);
  const pieces = splitAtQuietest(pcm, RATE);
  assert.equal(pieces[0]!.start, 0);
  assert.equal(pieces[pieces.length - 1]!.end, pcm.length);
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]!;
    assert.ok(p.end - p.start <= 55 * RATE, `piece ${i} is ${(p.end - p.start) / RATE}s`);
    if (i > 0) assert.equal(p.start, pieces[i - 1]!.end, 'pieces are contiguous');
  }
  // Each cut lands in a pause.
  for (const p of pieces.slice(0, -1)) {
    const cutSec = p.end / RATE;
    assert.ok((cutSec > 40 && cutSec < 41) || (cutSec > 85 && cutSec < 86), `cut at ${cutSec}s`);
  }
});

type FetchStub = (n: number) => { ok: boolean; status?: number; body: unknown };
async function withFetch<T>(stub: FetchStub, run: () => Promise<T>): Promise<{ result?: T; error?: unknown; calls: number }> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const r = stub(calls++);
    return {
      ok: r.ok,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  }) as unknown as typeof fetch;
  try {
    return { result: await run(), calls };
  } catch (error) {
    return { error, calls };
  } finally {
    globalThis.fetch = real;
  }
}
const azure = { key: 'k', region: 'r', language: 'fa-IR' };
const said = (text: string, confidence: number) => ({
  ok: true,
  body: { RecognitionStatus: 'Success', NBest: [{ Display: text, Confidence: confidence }] },
});

test('transcribe skips silent pieces of a long clip and weights confidence by length', async () => {
  // 40 s of speech, then 80 s of silence: the speaker talked only at first.
  const pcm = clip([[40, 3000], [80, 0]]);
  const { result, calls } = await withFetch(() => said('first part', 0.8), () =>
    transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(calls, 1, 'only the voiced piece is sent');
  assert.equal(result?.transcript, 'first part');
  assert.equal(result?.confidence, 0.8);
});

test('transcribe keeps the other pieces when one fails, and joins them in order', async () => {
  const pcm = clip([[50, 3000], [1, 0], [50, 3000], [1, 0], [18, 3000]]);
  const { result } = await withFetch(
    (n) => (n === 1 ? { ok: false, status: 400, body: 'bad' } : said(n === 0 ? 'one' : 'three', n === 0 ? 0.9 : 0.6)),
    () => transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(result?.transcript, 'one three');
  // Weighted by length: about 50 s at 0.9 and 18 s at 0.6.
  assert.ok(result?.confidence !== null && Math.abs((result?.confidence ?? 0) - (0.9 * 50.5 + 0.6 * 18.5) / 69) < 0.02);
});

test('transcribe fails a long clip only when every voiced piece fails', async () => {
  const pcm = clip([[60, 3000], [1, 0], [30, 3000]]);
  const { error } = await withFetch(() => ({ ok: false, status: 400, body: 'bad' }), () =>
    transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.ok(error instanceof Error && /Azure Speech 400/.test(error.message));
});
