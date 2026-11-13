/**
 * A report as the judge reads it: the text sections a player sees on the
 * review page, in the report's language.
 *
 * Reads the summary files the reviewer has written so far (god and blind). The
 * per-quest facts (leader, proposals, votes, mission) are included: in these
 * reports a model wrote them, so they are statements to check like any other.
 */

/** Quest facts are the per-quest leader, proposal and mission lines (in these
 *  reports a model writes them; later the page renders them from the record);
 *  prose is everything else. Measure 1 is reported for each. */
export type SectionKind = 'quest-facts' | 'prose';

export interface ReportSection {
  /** Where on the page: "narrative", "quest 2 facts", "performance: <name>", … */
  section: string;
  kind: SectionKind;
  text: string;
}

/** One sentence of a report: what the judge gives one verdict. */
export interface ReportSentence {
  id: number;
  section: string;
  kind: SectionKind;
  text: string;
}

export interface FinalGuess {
  player: string;
  guessedRole: string;
}

export interface JudgedReport {
  mode: 'god' | 'blind';
  sections: ReportSection[];
  /** Blind mode: the detective's final read, one guess per player. */
  finalGuesses: FinalGuess[];
}

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

function questSections(q: Json): ReportSection[] {
  const n = String(q.quest_number ?? '?');
  const facts: string[] = [];
  const leader = str(q.leader_display_name);
  if (leader) facts.push(`Leader: ${leader}`);
  for (const p of arr(q.proposals).map(obj)) {
    facts.push(
      `Proposal ${String(p.proposal_number ?? '?')}: team ${arr(p.team).map(str).join(', ')}; ` +
        `approved by ${arr(p.approvals).map(str).join(', ') || 'nobody'}; ` +
        `rejected by ${arr(p.rejections).map(str).join(', ') || 'nobody'}; ${str(p.status)}`
    );
  }
  const m = q.mission ? obj(q.mission) : null;
  if (m) {
    facts.push(
      `Mission: team ${arr(m.team).map(str).join(', ')}; ${String(m.success_count)} success, ` +
        `${String(m.fail_count)} fail; ${str(m.result)}`
    );
  }
  const prose: string[] = [];
  if (str(q.narrative_summary)) prose.push(str(q.narrative_summary));
  for (const t of arr(q.turning_points)) prose.push(`Turning point: ${str(t)}`);
  const mvp = q.mvp ? obj(q.mvp) : null;
  if (mvp) prose.push(`MVP: ${str(mvp.player)} — ${str(mvp.reason)}`);
  for (const sp of arr(q.suspicious_players).map(obj)) {
    prose.push(`Suspicious: ${str(sp.player)} — ${str(sp.reason)}`);
  }
  const out: ReportSection[] = [];
  if (facts.length) out.push({ section: `quest ${n} facts`, kind: 'quest-facts', text: facts.join('\n') });
  if (prose.length) out.push({ section: `quest ${n}`, kind: 'prose', text: prose.join('\n') });
  return out;
}

function discussionSection(d: Json): ReportSection | null {
  const lines: string[] = [];
  for (const s of arr(d.speakers).map(obj)) {
    const summary = obj(s.summary);
    const points = arr(summary.key_points).map(str).filter(Boolean);
    const quotes = arr(summary.notable_quotes).map(str).filter(Boolean);
    if (points.length === 0 && quotes.length === 0) continue;
    lines.push(`${str(s.display_name)}:`);
    for (const p of points) lines.push(`- ${p}`);
    for (const q of quotes) lines.push(`- quote: «${q}»`);
  }
  return lines.length
    ? { section: 'assassin-phase discussion', kind: 'prose', text: lines.join('\n') }
    : null;
}

/** Read a summary.<lang>.json into the sections the judge checks. */
export function readReport(summary: Json): JudgedReport {
  const mode: 'god' | 'blind' = summary.mode === 'blind' ? 'blind' : 'god';
  const sections: ReportSection[] = [];
  const push = (section: string, text: string) => {
    if (text.trim()) sections.push({ section, kind: 'prose', text });
  };

  if (mode === 'god') {
    push('role reveal', str(summary.role_reveal));
    push('narrative', str(summary.narrative));
    for (const p of arr(summary.performance).map(obj)) {
      push(`performance: ${str(p.player)}`, str(p.assessment));
    }
  } else {
    push('final summary', str(summary.final_summary));
    // The final guesses are scored by measure 3, not fact-checked. Their
    // reasons are the detective's notes on the last round of talk ("didn't
    // speak this round"), which a checker can't tie to a round reliably.
  }
  for (const q of arr(summary.quests).map(obj)) sections.push(...questSections(q));
  if (summary.discussion) {
    const s = discussionSection(obj(summary.discussion));
    if (s) sections.push(s);
  }

  const finalGuesses: FinalGuess[] =
    mode === 'blind'
      ? arr(summary.final_guesses)
          .map(obj)
          .map((g) => ({ player: str(g.player), guessedRole: str(g.guessed_role) }))
          .filter((g) => g.player)
      : [];

  return { mode, sections, finalGuesses };
}

/**
 * Split a report into numbered sentences, so the judge gives each exactly one
 * verdict and the same report always has the same count. Quest facts are one
 * line each; prose splits at sentence ends (., !, ?, ؟) and line breaks.
 */
export function reportSentences(report: JudgedReport): ReportSentence[] {
  const out: ReportSentence[] = [];
  for (const sec of report.sections) {
    const parts =
      sec.kind === 'quest-facts'
        ? sec.text.split('\n')
        : sec.text.split(/(?<=[.!?؟])\s+|\n+/u);
    for (const raw of parts) {
      const text = raw.replace(/^[-•]\s*/u, '').trim();
      if (text.length < 3) continue;
      out.push({ id: out.length + 1, section: sec.section, kind: sec.kind, text });
    }
  }
  return out;
}

/** The sentences as a numbered list for a prompt. */
export function sentencesText(sentences: ReportSentence[]): string {
  let section = '';
  const lines: string[] = [];
  for (const s of sentences) {
    if (s.section !== section) {
      section = s.section;
      lines.push(`### ${section}`);
    }
    lines.push(`[${s.id}] ${s.text}`);
  }
  return lines.join('\n');
}

/** The sections as one text block, for the Persian–English comparison. */
export function sectionsText(report: JudgedReport): string {
  return report.sections.map((s) => `### ${s.section}\n${s.text}`).join('\n\n');
}
