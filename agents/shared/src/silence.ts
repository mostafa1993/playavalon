/**
 * Cheap silence detection: a clip is silent when its loudest short window
 * (100 ms) is below an RMS threshold. Silent clips skip STT (saves API cost +
 * avoids feeding garbage to the LLM).
 *
 * The loudest window, not the whole clip's RMS: a short remark in a long clip
 * of room noise barely moves the clip's average — 0.6 s at RMS 1500 in 48 s of
 * noise at RMS 80 averages 186 — but its windows are as loud as any speech.
 *
 * PCM16 samples range ±32768. Typical quiet speech ≥ ~400 RMS; pure silence
 * on a live mic with noise suppression ≈ 20–80 RMS. Default threshold 250
 * is comfortably below voiced speech and well above typical noise floor.
 */

/** The window a clip's loudness is judged by. */
const WINDOW_MS = 100;

export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const v = pcm[i] ?? 0;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / pcm.length);
}

/** A piece of a clip: samples [start, end). */
export interface ClipPiece {
  start: number;
  end: number;
}

/**
 * A clip in `windowMs` windows, each with its RMS: back to back from the
 * start, every one full length, the last ending at the clip's end. A clip no
 * longer than a window is one window.
 */
function windows(pcm: Int16Array, sampleRate: number, windowMs: number): Array<ClipPiece & { rms: number }> {
  const win = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  if (pcm.length <= win) return [{ start: 0, end: pcm.length, rms: computeRms(pcm) }];
  const out: Array<ClipPiece & { rms: number }> = [];
  for (let w = 0; w + win <= pcm.length; w += win) {
    out.push({ start: w, end: w + win, rms: computeRms(pcm.subarray(w, w + win)) });
  }
  if (pcm.length % win !== 0) {
    out.push({ start: pcm.length - win, end: pcm.length, rms: computeRms(pcm.subarray(pcm.length - win)) });
  }
  return out;
}

/** The RMS of a clip's loudest `windowMs` window; of the whole clip when it is shorter. */
export function loudestWindowRms(pcm: Int16Array, sampleRate: number, windowMs = WINDOW_MS): number {
  return Math.max(...windows(pcm, sampleRate, windowMs).map((w) => w.rms));
}

/** Silent: empty, or no 100 ms window reaches the threshold. */
export function isSilent(pcm: Int16Array, sampleRate: number, thresholdRms: number): boolean {
  if (pcm.length === 0) return true;
  return loudestWindowRms(pcm, sampleRate) < thresholdRms;
}

/**
 * A clip without its leading and trailing quiet: from the first 100 ms window
 * that reaches the threshold to the last, with `marginSec` (0.3 s) kept on
 * each side. Everything between them is kept, pauses in the talk included.
 * Null when no window reaches the threshold: the clip is silent.
 */
export function voicedSpan(
  pcm: Int16Array,
  sampleRate: number,
  thresholdRms: number,
  marginSec = 0.3
): ClipPiece | null {
  if (pcm.length === 0) return null;
  const loud = windows(pcm, sampleRate, WINDOW_MS).filter((w) => w.rms >= thresholdRms);
  const first = loud[0];
  const last = loud.at(-1);
  if (!first || !last) return null;
  const margin = Math.floor(marginSec * sampleRate);
  return { start: Math.max(0, first.start - margin), end: Math.min(pcm.length, last.end + margin) };
}

/**
 * Cut a clip into pieces of `minSec` to `maxSec`, each cut at the quietest
 * `windowMs` window that leaves the piece before it, and what remains after
 * it, at least `minSec` long — so a cut falls in a pause rather than mid-word,
 * and no piece is a sliver (55.01 s is never 55 s and 0.01 s). A clip no
 * longer than `maxSec` is one piece. The pieces cover the whole clip, in
 * order. `minSec` is at most half of `maxSec`, so there is always room for a
 * cut.
 */
export function splitAtQuietest(
  pcm: Int16Array,
  sampleRate: number,
  { maxSec = 55, minSec = 20, windowMs = WINDOW_MS }: { maxSec?: number; minSec?: number; windowMs?: number } = {}
): ClipPiece[] {
  const max = Math.floor(maxSec * sampleRate);
  const min = Math.min(Math.floor(minSec * sampleRate), Math.floor(max / 2));
  const win = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  const pieces: ClipPiece[] = [];
  let start = 0;
  while (pcm.length - start > max) {
    // The cut leaves at least `min` before it and after it.
    const last = Math.min(start + max, pcm.length - min);
    let bestCut = last;
    let bestRms = Infinity;
    for (let w = start + min; w + win <= last; w += win) {
      const rms = computeRms(pcm.subarray(w, w + win));
      if (rms < bestRms) {
        bestRms = rms;
        bestCut = w + Math.floor(win / 2);
      }
    }
    pieces.push({ start, end: bestCut });
    start = bestCut;
  }
  pieces.push({ start, end: pcm.length });
  return pieces;
}
