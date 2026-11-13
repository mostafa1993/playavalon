/**
 * Low-confidence speech (plan D8): a transcript whose speech-to-text
 * confidence is below the threshold (LOW_CONFIDENCE_THRESHOLD, src/config.ts)
 * is flagged `low_confidence`, not dropped. The report never quotes it, and
 * the review page shows it marked as unreliable. A transcript with no
 * confidence (nothing was transcribed) is not flagged.
 */
export function isLowConfidence(confidence: number | null, threshold: number): boolean {
  return confidence !== null && confidence < threshold;
}
