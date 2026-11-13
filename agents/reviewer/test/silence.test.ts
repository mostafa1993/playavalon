import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRms, isSilent, loudestWindowRms, splitAtQuietest, transcribe, voicedSpan } from '@avalon/shared';
import { isLowConfidence } from '../src/reviewer/confidence.js';

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

const RATE = 16000;
/** Room noise, as a live mic hears between words: RMS about 80. */
const NOISE_RMS = 80;

/**
 * A clip of room noise with speech over it. `spec` is a list of
 * [seconds, speech RMS]: 0 is noise alone. The noise is a fixed pseudo-random
 * sequence (uniform, RMS 80), so every run cuts the same way.
 */
function clip(spec: Array<[number, number]>): Int16Array {
  const total = spec.reduce((n, [sec]) => n + Math.round(sec * RATE), 0);
  const out = new Int16Array(total);
  let seed = 12345;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 2 * NOISE_RMS * Math.sqrt(3);
  };
  let i = 0;
  for (const [sec, rms] of spec) {
    const n = Math.round(sec * RATE);
    // Alternate sign so speech has energy but no DC offset.
    for (let k = 0; k < n; k += 1) out[i + k] = Math.round(noise() + (k % 2 === 0 ? rms : -rms));
    i += n;
  }
  return out;
}

const seconds = (p: { start: number; end: number }) => (p.end - p.start) / RATE;

test('a clip of room noise is silent; empty buffers too', () => {
  const noise = clip([[48, 0]]);
  assert.ok(Math.abs(computeRms(noise) - NOISE_RMS) < 2);
  assert.equal(isSilent(noise, RATE, 250), true);
  assert.equal(isSilent(new Int16Array(0), RATE, 250), true);
  assert.equal(isSilent(clip([[3, 3000]]), RATE, 250), false);
});

test('a short remark in a long noisy clip is not silent, though the clip averages below the threshold', () => {
  // 0.6 s at RMS 1500 in 48 s of noise at RMS 80: the clip's RMS is about 186.
  const pcm = clip([[30, 0], [0.6, 1500], [17.4, 0]]);
  assert.ok(computeRms(pcm) < 250, `the clip averages ${computeRms(pcm)}`);
  assert.ok(loudestWindowRms(pcm, RATE) > 1400);
  assert.equal(isSilent(pcm, RATE, 250), false);
});

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
    assert.ok(p.end - p.start <= 55 * RATE, `piece ${i} is ${seconds(p)}s`);
    if (i > 0) assert.equal(p.start, pieces[i - 1]!.end, 'pieces are contiguous');
  }
  // Each cut lands in a pause.
  for (const p of pieces.slice(0, -1)) {
    const cutSec = p.end / RATE;
    assert.ok((cutSec > 40 && cutSec < 41) || (cutSec > 85 && cutSec < 86), `cut at ${cutSec}s`);
  }
});

test('splitAtQuietest never leaves a sliver: 55.01 s is cut in a pause that leaves 20 s on each side', () => {
  // The quietest point is a pause at 54.8–55 s, where a cut would leave a
  // sliver of 0.06 s; a softer pause at 30 s is the quietest that leaves enough.
  const pcm = clip([[30, 3000], [0.2, 300], [24.6, 3000], [0.2, 0], [0.01, 3000]]);
  const pieces = splitAtQuietest(pcm, RATE);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((p) => seconds(p) >= 20), pieces.map(seconds).join(', '));
  const cutSec = pieces[0]!.end / RATE;
  assert.ok(cutSec > 30 && cutSec < 30.2, `cut at ${cutSec}s`);
});

test('splitAtQuietest keeps every piece of a long clip between 20 and 55 s', () => {
  // Continuous talk, no pause anywhere: lengths just past a multiple of 55 s.
  for (const total of [55.01, 56, 110.2, 165.3]) {
    const pieces = splitAtQuietest(clip([[total, 2000]]), RATE);
    assert.equal(pieces.at(-1)!.end, Math.round(total * RATE));
    for (const p of pieces) {
      assert.ok(seconds(p) >= 20 && seconds(p) <= 55, `${total}s: a piece of ${seconds(p)}s`);
    }
  }
});

test('voicedSpan trims the leading and trailing quiet, keeps 0.3 s, and never cuts inside the talk', () => {
  // 8 s of room noise, talk, a 3 s pause, more talk, then 2 s of noise.
  const pcm = clip([[8, 0], [5, 3000], [3, 0], [5, 3000], [2, 0]]);
  const span = voicedSpan(pcm, RATE, 250)!;
  assert.ok(Math.abs(span.start / RATE - 7.7) < 0.05, `starts at ${span.start / RATE}s`);
  assert.ok(Math.abs(span.end / RATE - 21.3) < 0.15, `ends at ${span.end / RATE}s`);
  // Room noise alone has nothing above the threshold: silent.
  assert.equal(voicedSpan(clip([[30, 0]]), RATE, 250), null);
  assert.equal(voicedSpan(new Int16Array(0), RATE, 250), null);
});

type FetchStub = (n: number) => { ok: boolean; status?: number; body: unknown };
/** Stubs fetch with `stub`'s answers; `sentSec` is each request's audio, in seconds. */
async function withFetch<T>(
  stub: FetchStub,
  run: () => Promise<T>
): Promise<{ result?: T; error?: unknown; calls: number; sentSec: number[] }> {
  const real = globalThis.fetch;
  let calls = 0;
  const sentSec: number[] = [];
  globalThis.fetch = (async (_url: string, init: { body: Uint8Array }) => {
    // The body is a 44-byte WAV header and 16-bit samples.
    sentSec.push((init.body.length - 44) / 2 / RATE);
    const r = stub(calls++);
    return {
      ok: r.ok,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  }) as unknown as typeof fetch;
  try {
    return { result: await run(), calls, sentSec };
  } catch (error) {
    return { error, calls, sentSec };
  } finally {
    globalThis.fetch = real;
  }
}
const azure = { key: 'k', region: 'r', language: 'fa-IR' };
const said = (text: string, confidence: number) => ({
  ok: true,
  body: { RecognitionStatus: 'Success', NBest: [{ Display: text, Confidence: confidence }] },
});
const silenceTimeout = { ok: true, body: { RecognitionStatus: 'InitialSilenceTimeout' } };

test('transcribe sends a clip without its leading room noise, starting near the talk', async () => {
  // 8 s of room noise, then 20 s of talk: the request starts 0.3 s before it.
  const pcm = clip([[8, 0], [20, 3000]]);
  const { result, sentSec } = await withFetch(() => said('late start', 0.9), () =>
    transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(result?.transcript, 'late start');
  assert.equal(sentSec.length, 1);
  assert.ok(Math.abs(sentSec[0]! - 20.3) < 0.05, `sent ${sentSec[0]}s`);
});

test('an InitialSilenceTimeout answer is no speech heard: an empty transcript, not an error', async () => {
  const { result, error } = await withFetch(() => silenceTimeout, () =>
    transcribe(azure, clip([[3, 0], [0.2, 1500], [3, 0]]), RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(error, undefined);
  assert.deepEqual([result?.transcript, result?.confidence], ['', null]);
});

test("a long clip's piece that answers InitialSilenceTimeout has no weight in the confidence", async () => {
  // Two pieces cut in the pause: about 50.5 s of talk, then a cough in noise.
  const pcm = clip([[50, 3000], [1, 0], [20, 0], [0.2, 1500], [20, 0]]);
  const { result, calls } = await withFetch(
    (n) => (n === 0 ? said('the talk', 0.9) : silenceTimeout),
    () => transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(calls, 2);
  assert.equal(result?.transcript, 'the talk');
  assert.equal(result?.confidence, 0.9, 'a silence answer is not a lost piece');
  assert.equal(isLowConfidence(result?.confidence ?? null, 0.5), false);
});

test("a long clip's piece that Azure hears as no words (Success, empty, confidence 0) has no weight", async () => {
  // Seen live: a click in room noise comes back as Success with an empty
  // transcript and confidence 0. It must not pull a clear turn's confidence down.
  const pcm = clip([[50, 3000], [1, 0], [20, 0], [0.2, 1500], [20, 0]]);
  const { result, calls } = await withFetch(
    (n) => (n === 0 ? said('the talk', 0.9) : said('', 0)),
    () => transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(calls, 2);
  assert.equal(result?.transcript, 'the talk');
  assert.equal(result?.confidence, 0.9);
});

test('transcribe skips the noise-only pieces of a long clip', async () => {
  // 40 s of speech, then 80 s of room noise: the speaker talked only at first.
  const pcm = clip([[40, 3000], [80, 0]]);
  const { result, calls } = await withFetch(() => said('first part', 0.8), () =>
    transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(calls, 1, 'only the voiced piece is sent');
  assert.equal(result?.transcript, 'first part');
  assert.equal(result?.confidence, 0.8);
});

test('transcribe sends a piece that holds only a short remark in room noise', async () => {
  // 40 s of talk, then noise with a 0.6 s remark at 75 s: the second piece
  // averages below the threshold, but its remark is speech.
  const pcm = clip([[40, 3000], [35, 0], [0.6, 1500], [14.4, 0]]);
  const { result, calls, sentSec } = await withFetch(
    (n) => said(n === 0 ? 'first part' : 'yes', 0.8),
    () => transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(calls, 2, 'the remark is not skipped as silence');
  assert.equal(result?.transcript, 'first part yes');
  // The remark goes out with 0.3 s on each side, not behind 35 s of noise.
  assert.ok(sentSec[1]! > 1.1 && sentSec[1]! < 1.5, `sent ${sentSec[1]}s`);
});

test('transcribe keeps the other pieces when one fails, and counts the lost one as confidence 0', async () => {
  // Three pieces cut in the pauses: about 50.5 s, 51 s and 25.5 s.
  const pcm = clip([[50, 3000], [1, 0], [50, 3000], [1, 0], [25, 3000]]);
  const { result, calls } = await withFetch(
    (n) => (n === 1 ? { ok: false, status: 400, body: 'bad' } : said(n === 0 ? 'one' : 'three', n === 0 ? 0.9 : 0.6)),
    () => transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.equal(calls, 3);
  assert.equal(result?.transcript, 'one three');
  // Weighted by length, the lost minute at 0: (0.9 × 50.5 + 0 × 51 + 0.6 × 25.5) / 127.
  const confidence = result?.confidence ?? null;
  assert.ok(confidence !== null && Math.abs(confidence - (0.9 * 50.5 + 0.6 * 25.5) / 127) < 0.02, `${confidence}`);
  // Only what survived would have read 0.8: the transcript is flagged unclear.
  assert.equal(isLowConfidence(confidence, 0.5), true);
});

test('transcribe fails a long clip only when every voiced piece fails', async () => {
  const pcm = clip([[60, 3000], [1, 0], [30, 3000]]);
  const { error } = await withFetch(() => ({ ok: false, status: 400, body: 'bad' }), () =>
    transcribe(azure, pcm, RATE, { retry: { maxAttempts: 1 } })
  );
  assert.ok(error instanceof Error && /Azure Speech 400/.test(error.message));
});
