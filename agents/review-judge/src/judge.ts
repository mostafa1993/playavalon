/**
 * Judge one game's report: every sentence of the Persian report against the
 * god record, one verdict each, and the English report against the Persian one.
 */

import type { LLMClient } from '@avalon/shared';
import { recordText, type JudgeRecord } from './record.js';
import { reportSentences, sectionsText, sentencesText, type JudgedReport } from './report.js';
import type { SentenceVerdict, TranslationDifference, Verdicts } from './measures.js';

interface RawVerdict {
  id?: unknown;
  evidence?: unknown;
  kind?: unknown;
  verdict?: unknown;
}

const VERDICTS_BY_KIND: Record<string, readonly string[]> = {
  fact: ['supported', 'contradicted', 'not_in_record'],
  attribution: ['correct', 'misattributed', 'not_found'],
  none: ['none'],
};

/** Pair the judge's answers with the sentences; every sentence must have
 *  exactly one valid answer. */
export function matchVerdicts(
  sentences: ReturnType<typeof reportSentences>,
  raw: RawVerdict[]
): SentenceVerdict[] {
  const byId = new Map<number, RawVerdict>();
  for (const r of raw) {
    if (typeof r.id === 'number' && !byId.has(r.id)) byId.set(r.id, r);
  }
  const missing: number[] = [];
  const out: SentenceVerdict[] = [];
  for (const s of sentences) {
    const r = byId.get(s.id);
    const kind = typeof r?.kind === 'string' ? r.kind : '';
    const verdict = typeof r?.verdict === 'string' ? r.verdict : '';
    if (!r || !VERDICTS_BY_KIND[kind]?.includes(verdict)) {
      missing.push(s.id);
      continue;
    }
    out.push({
      id: s.id,
      section: s.section,
      sectionKind: s.kind,
      text: s.text,
      evidence: typeof r.evidence === 'string' ? r.evidence : '',
      kind: kind as SentenceVerdict['kind'],
      verdict: verdict as SentenceVerdict['verdict'],
    });
  }
  if (missing.length) {
    throw new Error(`judge gave no valid verdict for sentence(s) ${missing.join(', ')}`);
  }
  return out;
}

export async function judgeReport(
  llm: LLMClient,
  record: JudgeRecord,
  persian: JudgedReport,
  english: JudgedReport | null
): Promise<Verdicts> {
  const sentences = reportSentences(persian);
  const out = await llm.runJson<{ verdicts?: RawVerdict[] }>('judge-sentences.yml', {
    record: recordText(record),
    sentences: sentencesText(sentences),
    language: 'Persian',
  });
  if (!Array.isArray(out.verdicts)) throw new Error('judge-sentences returned no verdicts list');
  const verdicts = matchVerdicts(sentences, out.verdicts);

  let translation: TranslationDifference[] | null = null;
  if (english) {
    const t = await llm.runJson<{ differences?: TranslationDifference[] }>('judge-translation.yml', {
      persian_report: sectionsText(persian),
      english_report: sectionsText(english),
    });
    if (!Array.isArray(t.differences)) throw new Error('judge-translation returned no differences list');
    translation = t.differences;
  }

  return { sentences: verdicts, translation };
}
