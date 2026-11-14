/**
 * Transcript corrector — runs between Azure STT and the turn file.
 *
 * A proofreading LLM pass fixes the common classes of errors Azure's
 * Persian (fa-IR) STT produces: misheard words, players' names and game words,
 * wrong verb persons, homophone confusions, broken Persian spacing (ZWNJ /
 * half-space), number glitches.
 *
 * Code checks each correction against the raw transcript (proofreadCheck.ts):
 * a table name only where a raw word sounds like it, and no Latin letters the
 * raw text doesn't have. A correction that breaks it is asked for once more,
 * with what broke. A second answer that still puts names where the speaker
 * said none keeps its correction with those places put back to the raw words;
 * one with Latin letters fails the correction, so the turn keeps its raw
 * transcript: such an answer is sometimes the model's reasoning, in English and
 * cut short, which no place-by-place repair makes whole.
 *
 * Fails-soft: on any error, the caller is expected to fall back to the raw
 * transcript so the downstream pipeline is never blocked.
 */

import type { LLMClient } from '@avalon/shared';
import type { GameMetaSnapshot } from '../types.js';
import { checkProofread, type ProofreadBreak } from './proofreadCheck.js';

function recheckText(breaks: ProofreadBreak[]): string {
  return [
    '',
    'YOUR LAST ANSWER CHANGED WHAT THE SPEAKER SAID:',
    ...breaks.map((b) => {
      const what = [
        ...(b.names.length > 0
          ? [`no word the speaker said there sounds like ${b.names.map((n) => `«${n}»`).join(', ')}`]
          : []),
        ...(b.latin ? ['Latin letters'] : []),
      ];
      return `- «${b.wrote}» where the transcript has ${b.heard ? `«${b.heard}»` : 'nothing'}: ${what.join('; ')}`;
    }),
    'Proofread the raw transcript again, keeping to the rules on names and on Persian script.',
    '',
  ].join('\n');
}

/**
 * Proofread one transcript. The prompt gets the table's names, to recognize a
 * misheard name (it writes it in Persian script, as spoken), and lists the
 * game's words itself. Throws when the second answer still has Latin letters
 * the raw text doesn't.
 */
export async function correctTranscript(
  llm: LLMClient,
  rawTranscript: string,
  players: GameMetaSnapshot['players']
): Promise<string> {
  const names = players.map((p) => p.display_name);
  const vars = { raw_transcript: rawTranscript, players: names.map((n) => `- ${n}`).join('\n') };
  let recheck = '';
  for (let ask = 1; ; ask += 1) {
    // The model sometimes appends/prepends whitespace; trim for safety before
    // feeding downstream prompts.
    const corrected = (await llm.runText('correct-transcript.yml', { ...vars, recheck })).trim();
    const { breaks, reverted } = checkProofread(rawTranscript, corrected, names);
    if (breaks.length === 0) return corrected;
    if (ask === 2) {
      const latin = breaks.filter((b) => b.latin).map((b) => `«${b.wrote}»`);
      if (latin.length > 0) throw new Error(`the proofreading wrote Latin letters twice (${latin.join('; ')})`);
      return reverted;
    }
    recheck = recheckText(breaks);
  }
}
