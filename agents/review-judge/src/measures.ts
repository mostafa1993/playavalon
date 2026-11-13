/**
 * The plan's four measures for one report, from the judge's per-sentence
 * verdicts and the god record. Measure 3 is computed in code from the
 * detective's final guesses and the true roles; no model is involved in it.
 */

import type { JudgeRecord } from './record.js';
import type { FinalGuess, JudgedReport, SectionKind } from './report.js';

export type SentenceKind = 'fact' | 'attribution' | 'none';
export type FactVerdict = 'supported' | 'contradicted' | 'not_in_record';
export type AttributionVerdict = 'correct' | 'misattributed' | 'not_found';

/** One sentence of the report with the judge's verdict on it. */
export interface SentenceVerdict {
  id: number;
  section: string;
  sectionKind: SectionKind;
  text: string;
  evidence: string;
  kind: SentenceKind;
  verdict: FactVerdict | AttributionVerdict | 'none';
}

export interface TranslationDifference {
  section: string;
  english: string;
  issue: 'missing_in_persian' | 'contradicts_persian';
  persian: string;
}

export interface Verdicts {
  sentences: SentenceVerdict[];
  /** Null when no English report was judged. */
  translation: TranslationDifference[] | null;
}

export interface ShareOf {
  count: number;
  of: number;
  share: number | null;
}

export interface Measures {
  sentences: number;
  /** 1. Contradicted facts as a share of the report's fact sentences: overall
   *  (every section, a format-2 report's rendered roles included), in the
   *  prose, and in the per-quest facts (leader, proposals, mission). */
  contradicted: ShareOf;
  contradictedInProse: ShareOf;
  contradictedInQuestFacts: ShareOf;
  notInRecord: number;
  /** 2. Misattributed or unfound quotes and claims, as a share. */
  misattributed: ShareOf;
  /** 3. Blind mode only: the share of players whose guessed team is right, and
   *  whether the true Merlin was guessed as Merlin (null without one). */
  teamAccuracy: number | null;
  merlinNamed: boolean | null;
  /** Guesses whose name matches no player, and players with no guess. */
  unmatchedGuesses: string[];
  unguessedPlayers: string[];
  /** 4. English statements the Persian report doesn't make or contradicts. */
  translationDifferences: number | null;
}

const GOOD = ['merlin', 'percival', 'servant', 'loyal', 'good', 'مرلین', 'پرسیوال', 'شهروند', 'خدمتکار'];
const EVIL = ['assassin', 'morgana', 'mordred', 'oberon', 'minion', 'evil', 'lunatic', 'brute', 'آدمکش', 'قاتل', 'مورگانا', 'موردرد', 'اوبرون', 'مینیون', 'شرور'];

/** good / evil / null for a guessed role label, in English or Persian. */
export function teamOfGuess(label: string): 'good' | 'evil' | null {
  const l = label.toLowerCase();
  // Evil first: "Minion of Mordred" must not read as good through any word.
  if (EVIL.some((w) => l.includes(w))) return 'evil';
  if (GOOD.some((w) => l.includes(w))) return 'good';
  return null;
}

/** Names compare without case, spacing, or combining marks and joiners. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.normalize('NFKC').replace(/[\p{Mn}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

const shareOf = (count: number, of: number): ShareOf => ({
  count,
  of,
  share: of === 0 ? null : count / of,
});

function blindScore(record: JudgeRecord, guesses: FinalGuess[]) {
  const unmatchedGuesses = guesses
    .filter((g) => !record.players.some((p) => sameName(g.player, p.display_name)))
    .map((g) => g.player);
  const unguessedPlayers: string[] = [];
  let right = 0;
  for (const p of record.players) {
    const g = guesses.find((x) => sameName(x.player, p.display_name));
    if (!g) unguessedPlayers.push(p.display_name);
    else if (teamOfGuess(g.guessedRole) === p.role) right += 1;
  }
  const merlin = record.players.find((p) => p.special_role === 'merlin');
  let merlinNamed: boolean | null = null;
  if (merlin) {
    const g = guesses.find((x) => sameName(x.player, merlin.display_name));
    merlinNamed = !!g && /merlin|مرلین/i.test(g.guessedRole);
  }
  return { teamAccuracy: right / record.players.length, merlinNamed, unmatchedGuesses, unguessedPlayers };
}

function contradictedAmong(sentences: SentenceVerdict[]): ShareOf {
  const facts = sentences.filter((s) => s.kind === 'fact');
  return shareOf(facts.filter((s) => s.verdict === 'contradicted').length, facts.length);
}

export function computeMeasures(
  record: JudgeRecord,
  report: JudgedReport,
  verdicts: Verdicts
): Measures {
  const s = verdicts.sentences;
  const attributions = s.filter((x) => x.kind === 'attribution');
  const blind = report.mode === 'blind' ? blindScore(record, report.finalGuesses) : null;
  return {
    sentences: s.length,
    contradicted: contradictedAmong(s),
    contradictedInProse: contradictedAmong(s.filter((x) => x.sectionKind === 'prose')),
    contradictedInQuestFacts: contradictedAmong(s.filter((x) => x.sectionKind === 'quest-facts')),
    notInRecord: s.filter((x) => x.kind === 'fact' && x.verdict === 'not_in_record').length,
    misattributed: shareOf(attributions.filter((x) => x.verdict !== 'correct').length, attributions.length),
    teamAccuracy: blind?.teamAccuracy ?? null,
    merlinNamed: blind?.merlinNamed ?? null,
    unmatchedGuesses: blind?.unmatchedGuesses ?? [],
    unguessedPlayers: blind?.unguessedPlayers ?? [],
    translationDifferences: verdicts.translation === null ? null : verdicts.translation.length,
  };
}
