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
