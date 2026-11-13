/**
 * A report as the judge reads it: the text sections a player sees on the
 * review page, in the report's language.
 *
 * Reads both summary formats, since historical reports are judged too:
 *   - format 2 (plan row C): the facts are the record's, carried in the
 *     summary and rendered by the page — each quest's proposals (leader, team,
 *     votes), mission and Lady of the Lake, and in god mode the roles. They are
 *     read here as the page shows them; the model's words are the narrative,
 *     each quest's commentary and the performance notes. The assassin phase's
 *     transcripts are the record's own words and are not judged, nor are the
 *     pick and the outcome header (as before).
 *   - the earlier format (no `format` key): a model wrote every section,
 *     the per-quest facts included, so all are statements to check.
 */

/** Quest facts are the per-quest leader, proposal, mission (and, in format 2,
 *  Lady of the Lake) lines; roles are format 2's code-rendered role reveal,
 *  counted in the overall share only; prose is the model's text. Measure 1 is
 *  reported overall, for prose and for quest facts. */
export type SectionKind = 'quest-facts' | 'roles' | 'prose';

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

/** Format 2: the record's facts as the page renders them, and the model's text. */
function currentSections(summary: Json, mode: 'god' | 'blind'): ReportSection[] {
  const record = obj(summary.record);
  const players = arr(record.players).map(obj);
  const nameById = new Map(players.map((p) => [str(p.id), str(p.display_name)]));
  const name = (id: unknown) => nameById.get(str(id)) ?? str(id);
  const names = (ids: unknown) => arr(ids).map(name).join(', ');
  const sections: ReportSection[] = [];
  const push = (section: string, kind: SectionKind, text: string) => {
    if (text.trim()) sections.push({ section, kind, text });
  };

  if (mode === 'god') {
    push(
      'roles',
      'roles',
      [...players]
        .sort((a, b) => Number(a.seat_number) - Number(b.seat_number))
        .map((p) => {
          const role = str(p.special_role) || (p.role === 'evil' ? 'minion' : 'servant');
          return `Seat ${String(p.seat_number)}: ${str(p.display_name)} — ${role} (${str(p.role)})`;
        })
        .join('\n')
    );
  }
  push('narrative', 'prose', str(summary.narrative));
  for (const note of arr(summary.performance).map(obj)) {
    push(`performance: ${name(note.playerId)}`, 'prose', str(note.assessment));
  }

  const proposals = arr(record.proposals).map(obj);
  const missions = arr(record.missions).map(obj);
  const lady = arr(record.lady).map(obj);
  const commentary = arr(summary.quest_commentary).map(obj);
  const quests = [...new Set([...proposals, ...missions].map((x) => Number(x.quest)))]
    .filter((q) => q > 0)
    .sort((a, b) => a - b);
  for (const q of quests) {
    const facts: string[] = [];
    for (const p of proposals
      .filter((p) => Number(p.quest) === q)
      .sort((a, b) => Number(a.proposalNumber) - Number(b.proposalNumber))) {
      const votes = arr(p.votes).map(obj);
      const by = (vote: string) =>
        votes.filter((v) => v.vote === vote).map((v) => name(v.playerId)).join(', ') || 'nobody';
      facts.push(
        `Proposal ${q}.${String(p.proposalNumber)}: leader ${name(p.leaderId)}; team ${names(p.teamIds)}; ` +
          (p.status === 'pending'
            ? 'not voted'
            : `approved by ${by('approve')}; rejected by ${by('reject')}; ${str(p.status)}`)
      );
    }
    const m = missions.find((m) => Number(m.quest) === q);
    if (m) {
      facts.push(
        `Mission: team ${names(m.teamIds)}; ${String(m.successCount)} success, ` +
          `${String(m.failCount)} fail; ${str(m.result)}`
      );
    }
    for (const l of lady.filter((l) => Number(l.quest) === q)) {
      const seen = mode === 'god' && str(l.result) ? ` and saw ${str(l.result)}` : '';
      facts.push(`Lady of the Lake: ${name(l.investigatorId)} looked at ${name(l.targetId)}${seen}`);
    }
    push(`quest ${q} facts`, 'quest-facts', facts.join('\n'));
    push(`quest ${q}`, 'prose', commentary.filter((c) => Number(c.quest) === q).map((c) => str(c.commentary)).join('\n'));
  }
  return sections;
}

/** The earlier format: every section written by a model. */
function earlierSections(summary: Json, mode: 'god' | 'blind'): ReportSection[] {
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
  return sections;
}

/** Read a summary.<lang>.json, in either format, into the sections the judge checks. */
export function readReport(summary: Json): JudgedReport {
  const mode: 'god' | 'blind' = summary.mode === 'blind' ? 'blind' : 'god';
  const sections =
    summary.format === 2 ? currentSections(summary, mode) : earlierSections(summary, mode);

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
 * verdict and the same report always has the same count. Quest facts and roles
 * are one line each; prose splits at sentence ends (., !, ?, ؟) and line breaks.
 */
export function reportSentences(report: JudgedReport): ReportSentence[] {
  const out: ReportSentence[] = [];
  for (const sec of report.sections) {
    const parts =
      sec.kind === 'prose' ? sec.text.split(/(?<=[.!?؟])\s+|\n+/u) : sec.text.split('\n');
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
