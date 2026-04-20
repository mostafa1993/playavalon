/**
 * Transcript corrector — runs between Azure STT and the per-turn summarizer.
 *
 * A proofreading LLM pass fixes the common classes of errors Azure's
 * Persian (fa-IR) STT produces: misheard words, wrong verb persons, homophone
 * confusions, broken Persian spacing (ZWNJ / half-space), number glitches.
 *
 * Fails-soft: on any error, the caller is expected to fall back to the raw
 * transcript so the downstream pipeline is never blocked.
 */

import type { LLMClient } from './llm.js';

export async function correctTranscript(
  llm: LLMClient,
  rawTranscript: string
): Promise<string> {
  const corrected = await llm.runText('correct-transcript.yml', {
    raw_transcript: rawTranscript,
  });
  // The model sometimes appends/prepends whitespace; trim for safety before
  // feeding downstream prompts.
  return corrected.trim();
}
