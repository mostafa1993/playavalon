/**
 * Transcript corrector — runs between Azure STT and the turn file.
 *
 * A proofreading LLM pass fixes the common classes of errors Azure's
 * Persian (fa-IR) STT produces: misheard words, players' names and game words,
 * wrong verb persons, homophone confusions, broken Persian spacing (ZWNJ /
 * half-space), number glitches.
 *
 * Fails-soft: on any error, the caller is expected to fall back to the raw
 * transcript so the downstream pipeline is never blocked.
 */

import type { LLMClient } from '@avalon/shared';
import type { GameMetaSnapshot } from '../types.js';

/**
 * Proofread one transcript. The prompt gets the table's names, to recognize a
 * misheard name (it writes it in Persian script, as spoken), and lists the
 * game's words itself.
 */
export async function correctTranscript(
  llm: LLMClient,
  rawTranscript: string,
  players: GameMetaSnapshot['players']
): Promise<string> {
  const corrected = await llm.runText('correct-transcript.yml', {
    raw_transcript: rawTranscript,
    players: players.map((p) => `- ${p.display_name}`).join('\n'),
  });
  // The model sometimes appends/prepends whitespace; trim for safety before
  // feeding downstream prompts.
  return corrected.trim();
}
