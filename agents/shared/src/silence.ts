/**
 * Cheap silence detection: compute RMS of PCM16 samples and compare to a
 * threshold. Clips whose RMS is below the threshold are treated as silent
 * and STT is skipped (saves API cost + avoids feeding garbage to the LLM).
 *
 * PCM16 samples range ±32768. Typical quiet speech ≥ ~400 RMS; pure silence
 * on a live mic with noise suppression ≈ 20–80 RMS. Default threshold 250
 * is comfortably below voiced speech and well above typical noise floor.
 */

export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const v = pcm[i] ?? 0;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / pcm.length);
}

export function isSilent(pcm: Int16Array, thresholdRms: number): boolean {
  if (pcm.length === 0) return true;
  return computeRms(pcm) < thresholdRms;
}

/** A piece of a clip: samples [start, end). */
export interface ClipPiece {
  start: number;
  end: number;
}

/**
 * Cut a clip into pieces of at most `maxSec`, each cut at the quietest
 * `windowMs` window between `minSec` and `maxSec` after the previous cut, so
 * a cut falls in a pause rather than mid-word. A clip no longer than `maxSec`
 * is one piece. The pieces cover the whole clip, in order.
 */
export function splitAtQuietest(
  pcm: Int16Array,
  sampleRate: number,
  { maxSec = 55, minSec = 20, windowMs = 100 }: { maxSec?: number; minSec?: number; windowMs?: number } = {}
): ClipPiece[] {
  const max = Math.floor(maxSec * sampleRate);
  const min = Math.floor(minSec * sampleRate);
  const win = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  const pieces: ClipPiece[] = [];
  let start = 0;
  while (pcm.length - start > max) {
    let bestCut = start + max;
    let bestRms = Infinity;
    for (let w = start + min; w + win <= start + max; w += win) {
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
