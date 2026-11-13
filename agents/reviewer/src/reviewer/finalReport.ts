/**
 * The final report, from the whole game record (plan rows C and G).
 *
 * One model call reads the record as text — the roster, then every proposal
 * with its leader, team, talk and vote, every mission, Lady of the Lake, the
 * assassin phase and the outcome, in order (`recordText`) — and writes, in
 * Persian, only the story and the commentary: the narrative, a short
 * commentary per quest, and in god mode a performance note per player. No
 * tools: the record is all in the prompt. Once checked (checkReport.ts), the
 * Persian report is translated into English (`translateReport`), so the two
 * say the same thing.
 *
 * The facts the page shows — roles, leaders, teams, votes, missions, Lady of
 * the Lake, the assassin's pick — are the record's own, carried in the summary
 * (`record`, without the turns' talk) and rendered by the page. A blind report
 * reads the blind record, which holds no role and no Lady result.
 */

import type { LLMClient } from '@avalon/shared';
import { formatRolesInPlay, type RolesInPlay } from '../gamestate/roleConfig.js';
import type { GameLog } from '../pipeline.js';
import {
  SUMMARY_FORMAT,
  type BlindGameRecord,
  type BlindSummaryJson,
  type GameRecord,
  type GodGameRecord,
  type GodSummaryJson,
  type GuessRound,
  type PlayerPerformance,
  type QuestCommentary,
  type RecordProposal,
  type RecordTurn,
  type ReportRecord,
  type RoleGuess,
  type SummaryJson,
} from '../types.js';

/** The quests a record has anything for, in order (the intro, quest 0, aside). */
export function recordQuests(record: GameRecord): number[] {
  const quests = new Set<number>([
    ...record.proposals.map((p) => p.quest),
    ...record.missions.map((m) => m.quest),
    ...record.turns.map((t) => t.quest),
  ]);
  quests.delete(0);
  return [...quests].sort((a, b) => a - b);
}

/** A turn's label, counted from 1 as players count: `quest.round.turn`, or
 *  `intro.turn` for the introductions. The judge labels turns the same way. */
export function talkLabel(t: Pick<RecordTurn, 'quest' | 'round' | 'turn'>): string {
  return t.quest === 0 ? `intro.${t.turn + 1}` : `${t.quest}.${t.round + 1}.${t.turn + 1}`;
}

/** How the record marks a transcript flagged low_confidence (plan D8). */
const LOW_CONFIDENCE_MARK = '[low confidence]';

/**
 * A player's talk fenced as data from the game: between <talk> and </talk>,
 * which every prompt that reads the record names as what a player said, never
 * an instruction. Angle brackets are taken out of the talk, so no talk can
 * close its fence, and line breaks, so it stays on its own record line.
 */
export function fencedTalk(transcript: string): string {
  return `<talk>${transcript.replace(/[<>]/g, '').replace(/\s*\n\s*/g, ' ')}</talk>`;
}

/**
 * The record as the report's prompt reads it: names instead of ids, and the
 * game in order — each proposal followed by the talk about it and its vote,
 * each quest's mission and Lady of the Lake after its proposals. Each
 * transcript is fenced (`fencedTalk`); one flagged low_confidence is marked.
 * Roles only in a god record; a blind record has none to give. A cut record
 * (the blind detective's) ends where it was cut, with no outcome.
 */
export function recordText(record: GameRecord): string {
  const nameById = new Map(record.players.map((p) => [p.id, p.display_name]));
  const name = (id: string) => nameById.get(id) ?? id;
  const names = (ids: string[]) => (ids.length > 0 ? ids.map(name).join(', ') : 'nobody');
  const said = (transcript: string) =>
    transcript.trim() ? fencedTalk(transcript.trim()) : '(no transcript)';
  // Speech the recognizer was unsure of: the prompts never quote it.
  const unsure = (s: { low_confidence: boolean }) =>
    s.low_confidence ? ` ${LOW_CONFIDENCE_MARK}` : '';
  const turnLine = (t: RecordTurn) =>
    `${talkLabel(t)} ${name(t.speakerId)}${unsure(t)}: ${said(t.transcript)}`;
  const lines: string[] = [];

  if (record.mode === 'god') {
    lines.push('PLAYERS (seat: name — true role)');
    for (const p of record.players) {
      lines.push(
        `seat ${p.seat_number}: ${p.display_name} — ${p.role}${p.special_role ? ` (${p.special_role})` : ''}`
      );
    }
  } else {
    lines.push('PLAYERS (seat: name)');
    for (const p of record.players) lines.push(`seat ${p.seat_number}: ${p.display_name}`);
  }

  // What the investigator saw only in god mode.
  const ladyLines =
    record.mode === 'god'
      ? record.lady.map((l) => ({
          quest: l.quest,
          text: `${name(l.investigatorId)} looked at ${name(l.targetId)} and saw ${l.result}`,
        }))
      : record.lady.map((l) => ({
          quest: l.quest,
          text: `${name(l.investigatorId)} looked at ${name(l.targetId)} (what ${name(l.investigatorId)} saw stayed private)`,
        }));

  const intro = record.turns.filter((t) => t.quest === 0);
  if (intro.length > 0) {
    lines.push('', 'INTRODUCTIONS (before quest 1)');
    for (const t of intro) lines.push(turnLine(t));
  }

  for (const quest of recordQuests(record)) {
    lines.push('', `QUEST ${quest}`);
    const talk = record.turns.filter((t) => t.quest === quest);
    // Talk in a quest that never had a proposal.
    for (const t of talk.filter((t) => t.proposalNumber === null)) lines.push(turnLine(t));
    for (const p of record.proposals.filter((p) => p.quest === quest)) {
      lines.push(
        `Proposal ${quest}.${p.proposalNumber}: leader ${name(p.leaderId)}; team ${names(p.teamIds)}`
      );
      for (const t of talk.filter((t) => t.proposalNumber === p.proposalNumber)) {
        lines.push(`  ${turnLine(t)}`);
      }
      lines.push(`  ${voteLine(p, names)}`);
    }
    const mission = record.missions.find((m) => m.quest === quest);
    if (mission) {
      lines.push(
        `Mission ${quest}: team ${names(mission.teamIds)}; ${mission.successCount} success, ` +
          `${mission.failCount} fail → ${mission.result}`
      );
    }
    for (const l of ladyLines.filter((l) => l.quest === quest)) {
      lines.push(`Lady of the Lake after quest ${quest}: ${l.text}`);
    }
  }

  if (record.discussion || record.assassinPickId) {
    lines.push('', 'ASSASSIN PHASE');
    if (record.discussion) {
      const speakers = record.discussion.speakers.filter((s) => s.transcript.trim());
      lines.push('The discussion before the pick:');
      if (speakers.length === 0) lines.push('  (nothing transcribed)');
      for (const s of speakers) {
        lines.push(`  ${name(s.speakerId)}${unsure(s)}: ${said(s.transcript)}`);
      }
    }
    lines.push(
      `The assassin's pick (named as Merlin): ${record.assassinPickId ? name(record.assassinPickId) : 'none'}`
    );
  }

  if (record.cut) {
    const { quest, round } = record.cut;
    const where = quest === 0 ? 'the introductions' : `quest ${quest}, round ${round + 1}`;
    lines.push('', `SO FAR: the record ends after ${where}; the game goes on.`);
    return lines.join('\n');
  }

  const outcome = record.outcome;
  lines.push(
    '',
    `OUTCOME: ${outcome?.winner ?? 'unknown'} won (${outcome?.win_reason ?? 'reason unknown'})`
  );
  return lines.join('\n');
}

function voteLine(p: RecordProposal, names: (ids: string[]) => string): string {
  const where = `${p.quest}.${p.proposalNumber}`;
  if (p.status === 'pending') return `No vote on proposal ${where}: the game ended first`;
  const approve = p.votes.filter((v) => v.vote === 'approve').map((v) => v.playerId);
  const reject = p.votes.filter((v) => v.vote === 'reject').map((v) => v.playerId);
  return `Vote on proposal ${where}: approve ${names(approve)}; reject ${names(reject)} → ${p.status}`;
}

/** The detective's read after each round, one line per round. */
export function guessTimelineText(timeline: GuessRound[]): string {
  if (timeline.length === 0) return '(no reads recorded)';
  return timeline
    .map((r) => {
      const when =
        r.quest === 0
          ? 'after the introductions'
          : `after quest ${r.quest}, round ${r.proposal_round + 1}`;
      return `${when}: ${r.guesses.map((g) => `${g.player} ${g.guessed_role} (${g.confidence})`).join('; ')}`;
    })
    .join('\n');
}

/** The detective's final read, with its reasons. */
export function finalGuessesText(guesses: RoleGuess[]): string {
  if (guesses.length === 0) return '(none)';
  return guesses
    .map((g) => `- ${g.player}: ${g.guessed_role} (${g.confidence}) — ${g.reasoning}`)
    .join('\n');
}

/** Names compare without case, spacing, or combining marks and joiners. */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.normalize('NFKC').replace(/[\p{Mn}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const items = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];

interface ReportOutput {
  narrative?: unknown;
  quests?: unknown;
  performance?: unknown;
}

/** The model's commentary, kept for the record's quests only, once each, in order. */
export function questCommentary(raw: unknown, record: GameRecord): QuestCommentary[] {
  const quests = new Set(recordQuests(record));
  const byQuest = new Map<number, string>();
  for (const item of items(raw)) {
    const quest = Number(item.quest);
    const commentary = str(item.commentary);
    if (quests.has(quest) && commentary && !byQuest.has(quest)) byQuest.set(quest, commentary);
  }
  return [...byQuest.entries()]
    .sort(([a], [b]) => a - b)
    .map(([quest, commentary]) => ({ quest, commentary }));
}

/** The model's performance notes, tied to the record's players by name, once
 *  each, in seat order. A note for a name not in the record is dropped. */
export function performanceNotes(raw: unknown, record: GodGameRecord): PlayerPerformance[] {
  const byPlayer = new Map<string, string>();
  for (const item of items(raw)) {
    const player = record.players.find((p) => sameName(p.display_name, str(item.player)));
    const assessment = str(item.assessment);
    if (player && assessment && !byPlayer.has(player.id)) byPlayer.set(player.id, assessment);
  }
  return record.players
    .filter((p) => byPlayer.has(p.id))
    .map((p) => ({ playerId: p.id, assessment: byPlayer.get(p.id)! }));
}

/** The record as the summary carries it: everything but the turns' talk. */
function reportRecord<R extends GameRecord>(record: R): ReportRecord<R> {
  const { turns: _talk, cut: _cut, ...facts } = record;
  return facts;
}

async function runReport(
  llm: LLMClient,
  promptFile: string,
  vars: Record<string, string>
): Promise<ReportOutput & { narrative: string }> {
  const out = await llm.runJson<ReportOutput>(promptFile, vars);
  const narrative = str(out?.narrative);
  if (!narrative) throw new Error(`${promptFile} returned no narrative`);
  return { ...out, narrative };
}

/** God mode: the report, in Persian, with a performance note per player. */
export async function writeGodReport(
  llm: LLMClient,
  record: GodGameRecord,
  roomCode: string
): Promise<GodSummaryJson> {
  const out = await runReport(llm, 'report-god.yml', { record: recordText(record) });
  return {
    format: SUMMARY_FORMAT,
    mode: 'god',
    language: 'fa',
    gameId: record.gameId,
    roomCode,
    generatedAt: new Date().toISOString(),
    narrative: out.narrative,
    quest_commentary: questCommentary(out.quests, record),
    record: reportRecord(record),
    performance: performanceNotes(out.performance, record),
  };
}

/** What the blind report adds to the record: the public setup and the
 *  detective's guesses. */
export interface DetectiveRead {
  rolesInPlay: RolesInPlay | null | undefined;
  timeline: GuessRound[];
  finalGuesses: RoleGuess[];
}

/** Blind mode: the report, in Persian, from the blind record. */
export async function writeBlindReport(
  llm: LLMClient,
  record: BlindGameRecord,
  detective: DetectiveRead,
  roomCode: string
): Promise<BlindSummaryJson> {
  const out = await runReport(llm, 'report-blind.yml', {
    record: recordText(record),
    roles_in_play: formatRolesInPlay(detective.rolesInPlay),
    guess_timeline: guessTimelineText(detective.timeline),
    final_guesses: finalGuessesText(detective.finalGuesses),
  });
  return {
    format: SUMMARY_FORMAT,
    mode: 'blind',
    language: 'fa',
    gameId: record.gameId,
    roomCode,
    generatedAt: new Date().toISOString(),
    narrative: out.narrative,
    quest_commentary: questCommentary(out.quests, record),
    record: reportRecord(record),
    guess_timeline: detective.timeline,
    final_guesses: detective.finalGuesses,
  };
}

/**
 * A translation's answer read against the Persian report: the English report,
 * or what keeps it from being one — no narrative, a quest or a player's note
 * left out.
 */
function readTranslation(
  out: ReportOutput | null | undefined,
  record: GameRecord,
  persian: SummaryJson
): { english: SummaryJson | null; problems: string[] } {
  const nameById = new Map(record.players.map((p) => [p.id, p.display_name]));
  const problems: string[] = [];
  const narrative = str(out?.narrative);
  if (!narrative) problems.push('it has no narrative');
  const quest_commentary = questCommentary(out?.quests, record);
  const missingQuests = persian.quest_commentary
    .map((c) => c.quest)
    .filter((q) => !quest_commentary.some((c) => c.quest === q));
  if (missingQuests.length > 0) {
    problems.push(`it left out the commentary on quest ${missingQuests.join(', ')}`);
  }
  const translated = { language: 'en' as const, narrative, quest_commentary };
  if (persian.mode === 'blind' || record.mode === 'blind') {
    return { english: problems.length > 0 ? null : { ...persian, ...translated }, problems };
  }

  const performance = performanceNotes(out?.performance, record);
  const missingPlayers = persian.performance
    .filter((p) => !performance.some((n) => n.playerId === p.playerId))
    .map((p) => nameById.get(p.playerId) ?? p.playerId);
  if (missingPlayers.length > 0) {
    problems.push(`it left out the performance note on ${missingPlayers.join(', ')}`);
  }
  return {
    english: problems.length > 0 ? null : { ...persian, ...translated, performance },
    problems,
  };
}

/** The note that asks for the translation again, with what was wrong. */
function translationRecheck(problems: string[]): string {
  return [
    '',
    'YOUR LAST ANSWER COULD NOT BE USED:',
    ...problems.map((p) => `- ${p}`),
    'Translate the whole report again, as one complete JSON object of the shape above.',
    '',
  ].join('\n');
}

/**
 * The English report: the (checked) Persian report's narrative, quest
 * commentary and performance notes translated by one call
 * (`prompts/translate-report.yml`), around the same record and, in blind mode,
 * the same reads. Every quest and player of the Persian report must come back.
 * An answer that can't be used — the call failed, its JSON is broken or cut
 * off, or a part is missing — is asked for once more, with what was wrong; a
 * second such answer fails the translation.
 */
export async function translateReport(
  llm: LLMClient,
  record: GameRecord,
  persian: SummaryJson,
  log: GameLog
): Promise<SummaryJson> {
  const nameById = new Map(record.players.map((p) => [p.id, p.display_name]));
  const report = {
    narrative: persian.narrative,
    quests: persian.quest_commentary,
    performance:
      persian.mode === 'god'
        ? persian.performance.map((p) => ({
            player: nameById.get(p.playerId) ?? p.playerId,
            assessment: p.assessment,
          }))
        : [],
  };
  const vars = {
    players: record.players.map((p) => `- ${p.display_name}`).join('\n'),
    report: JSON.stringify(report, null, 2),
  };

  let recheck = '';
  for (let ask = 1; ; ask += 1) {
    const answer = await llm.runJson<ReportOutput>('translate-report.yml', { ...vars, recheck }).then(
      (out) => readTranslation(out, record, persian),
      (err: unknown) => ({
        english: null,
        problems: [`the call failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`],
      })
    );
    if (answer.english) return answer.english;
    if (ask === 2) {
      throw new Error(`translate-report.yml, asked twice: ${answer.problems.join('; ')}`);
    }
    log.error(`translation: ${answer.problems.join('; ')}; asking again`);
    recheck = translationRecheck(answer.problems);
  }
}
