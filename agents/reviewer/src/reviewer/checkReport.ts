/**
 * The report's check (plan row D, D5): after the report is written, one call
 * ties each of its statements to the record lines it rests on, and each
 * statement it flags gets one rewrite, which the report keeps.
 *
 * Code splits the model's text — the narrative, each quest's commentary and
 * the performance notes — into numbered statements, and numbers the lines of
 * the record the report was written from (`recordText`). The check
 * (`prompts/check-report.yml`) gives every statement its kind, the record
 * lines it rests on and a verdict. Code flags a fact or attribution whose
 * verdict isn't "ok", or that cites no line the record has. The flagged
 * statements go to one rewrite call (`prompts/rewrite-report.yml`), each once,
 * and the rewrites take their places in the text; a report with nothing
 * flagged skips it. A rewrite is not checked again.
 *
 * The check is not the judge (agents/review-judge): its prompt is its own,
 * though the model is the same.
 */

import type { LLMClient } from '@avalon/shared';
import { recordText } from './finalReport.js';
import type { CheckedStatement, GameRecord, ReportCheck, SummaryJson } from '../types.js';

/** One statement of a section's text, and the whitespace after it. */
interface Piece {
  id: number;
  text: string;
  after: string;
}

/** A part of the report the model wrote, in statements. */
interface Section {
  title: string;
  pieces: Piece[];
}

/** A statement ends at ., !, ? or ؟ followed by whitespace, or at a line break. */
const STATEMENT_END = /((?<=[.!?؟])\s+|\n+)/u;

/**
 * A text in statements, each with the whitespace that follows it, so the
 * pieces join back into the text (trimmed).
 */
export function splitStatements(text: string): Array<{ text: string; after: string }> {
  const parts = text.trim().split(STATEMENT_END);
  const out: Array<{ text: string; after: string }> = [];
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i] ?? '';
    const separator = parts[i + 1] ?? '';
    const body = raw.trim();
    const last = out.at(-1);
    if (!body) {
      if (last) last.after += raw + separator;
      continue;
    }
    const lead = raw.slice(0, raw.indexOf(body));
    if (last) last.after += lead;
    out.push({ text: body, after: raw.slice(lead.length + body.length) + separator });
  }
  return out;
}

/**
 * The pieces joined back, with each rewrite in its statement's place. A
 * statement rewritten as "" is removed; a paragraph break after it stays.
 */
export function joinStatements(pieces: Piece[], rewrites: Map<number, string>): string {
  const out: Array<{ text: string; after: string }> = [];
  for (const p of pieces) {
    const rewrite = rewrites.get(p.id);
    // A rewrite is one statement: it never breaks the paragraph.
    const text = rewrite === undefined ? p.text : rewrite.replace(/\s*\n\s*/g, ' ').trim();
    if (text) {
      out.push({ text, after: p.after });
      continue;
    }
    const prev = out.at(-1);
    if (prev && p.after.includes('\n') && !prev.after.includes('\n')) prev.after = p.after;
  }
  return out
    .map((p) => p.text + p.after)
    .join('')
    .trim();
}

/** The record's lines numbered [1], [2], … (blank lines are not numbered). */
export function numberedRecord(text: string): { text: string; lines: number } {
  let n = 0;
  const numbered = text
    .split('\n')
    .map((line) => (line.trim() ? `[${++n}] ${line}` : line))
    .join('\n');
  return { text: numbered, lines: n };
}

function reportSections(summary: SummaryJson, record: GameRecord): Section[] {
  const nameById = new Map(record.players.map((p) => [p.id, p.display_name]));
  let id = 0;
  const section = (title: string, text: string): Section => ({
    title,
    pieces: splitStatements(text).map((p) => ({ id: ++id, ...p })),
  });
  return [
    section('narrative', summary.narrative),
    ...summary.quest_commentary.map((c) => section(`quest ${c.quest} commentary`, c.commentary)),
    ...(summary.mode === 'god'
      ? summary.performance.map((p) =>
          section(`performance note: ${nameById.get(p.playerId) ?? p.playerId}`, p.assessment)
        )
      : []),
  ];
}

/** The statements as the check and the rewrite read them, under their sections. */
export function statementsText(sections: Section[]): string {
  return sections
    .filter((s) => s.pieces.length > 0)
    .map((s) => [`### ${s.title}`, ...s.pieces.map((p) => `[${p.id}] ${p.text}`)].join('\n'))
    .join('\n\n');
}

const KINDS = ['fact', 'attribution', 'opinion'] as const;
const isKind = (v: unknown): v is (typeof KINDS)[number] =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const items = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    : [];

/**
 * The check's answer, statement by statement. A fact or attribution is
 * flagged when its verdict isn't "ok" or it rests on no line the record has.
 * A statement the check gave no answer for is left as written.
 */
export function readCheck(
  raw: unknown,
  statements: Array<{ id: number; section: string; text: string }>,
  recordLines: number
): CheckedStatement[] {
  const byId = new Map<number, Record<string, unknown>>();
  for (const item of items(raw)) {
    const id = Number(item.id);
    if (Number.isInteger(id) && !byId.has(id)) byId.set(id, item);
  }
  return statements.map((s) => {
    const r = byId.get(s.id);
    if (!r || !isKind(r.kind)) {
      return { ...s, kind: null, lines: [], verdict: null, flagged: false, problem: '' };
    }
    const lines = (Array.isArray(r.lines) ? r.lines : [])
      .map(Number)
      .filter((n) => Number.isInteger(n));
    const verdict = str(r.verdict) || 'ok';
    if (r.kind === 'opinion') {
      return { ...s, kind: r.kind, lines, verdict, flagged: false, problem: '' };
    }
    const missing = lines.filter((n) => n < 1 || n > recordLines);
    const problem =
      verdict !== 'ok'
        ? str(r.problem) || `the check found it ${verdict}`
        : lines.length === 0
          ? 'the check tied it to no record line'
          : missing.length > 0
            ? `the check tied it to lines the record does not have (${missing.join(', ')})`
            : '';
    return { ...s, kind: r.kind, lines, verdict, flagged: problem !== '', problem };
  });
}

function flaggedText(flagged: CheckedStatement[]): string {
  return flagged
    .map(
      (s) =>
        `[${s.id}] (${s.section}) ${s.text}\n    check: ${s.problem}` +
        (s.lines.length > 0 ? ` (record lines ${s.lines.join(', ')})` : '')
    )
    .join('\n');
}

/** The rewrite's answer for the flagged statements only, once each. */
function readRewrites(raw: unknown, flagged: CheckedStatement[]): Map<number, string> {
  const ids = new Set(flagged.map((s) => s.id));
  const out = new Map<number, string>();
  for (const item of items(raw)) {
    const id = Number(item.id);
    if (ids.has(id) && !out.has(id) && typeof item.text === 'string') out.set(id, item.text.trim());
  }
  return out;
}

/**
 * Check a written report against the record it was written from, and rewrite
 * what the check flags. Returns the report with the rewrites in place, and the
 * check (every statement as written, what was found, what replaced it).
 */
export async function checkReport(
  llm: LLMClient,
  record: GameRecord,
  summary: SummaryJson
): Promise<{ summary: SummaryJson; check: ReportCheck }> {
  const sections = reportSections(summary, record);
  const statements = sections.flatMap((s) =>
    s.pieces.map((p) => ({ id: p.id, section: s.title, text: p.text }))
  );
  const numbered = numberedRecord(recordText(record));
  const vars = { record: numbered.text, statements: statementsText(sections) };

  const out = await llm.runJson<{ statements?: unknown }>('check-report.yml', vars);
  if (!Array.isArray(out?.statements)) {
    throw new Error('check-report.yml returned no statements list');
  }
  const checked = readCheck(out.statements, statements, numbered.lines);
  const flagged = checked.filter((s) => s.flagged);
  if (flagged.length === 0) {
    return { summary, check: { language: summary.language, statements: checked } };
  }

  const answer = await llm.runJson<{ rewrites?: unknown }>('rewrite-report.yml', {
    ...vars,
    flagged: flaggedText(flagged),
  });
  const rewrites = readRewrites(answer?.rewrites, flagged);
  const check: ReportCheck = {
    language: summary.language,
    statements: checked.map((s) => (s.flagged ? { ...s, rewrite: rewrites.get(s.id) ?? null } : s)),
  };

  const [narrative, ...rest] = sections.map((s) => joinStatements(s.pieces, rewrites));
  if (!narrative) throw new Error('the rewrite left the report with no narrative');
  const commentary = summary.quest_commentary.map((c, i) => ({
    quest: c.quest,
    commentary: rest[i] ?? '',
  }));
  const notes = rest.slice(summary.quest_commentary.length);
  const quest_commentary = commentary.filter((c) => c.commentary);
  const next: SummaryJson =
    summary.mode === 'god'
      ? {
          ...summary,
          narrative,
          quest_commentary,
          performance: summary.performance
            .map((p, i) => ({ playerId: p.playerId, assessment: notes[i] ?? '' }))
            .filter((p) => p.assessment),
        }
      : { ...summary, narrative, quest_commentary };
  return { summary: next, check };
}
