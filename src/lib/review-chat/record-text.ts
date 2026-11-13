/**
 * The game record as text for the chat's model: the seats with everyone's
 * true role, the intro talk, then each quest in order — each proposal after
 * the talk about it, with its leader, team and every vote — its mission and
 * Lady of the Lake, then the assassin phase and the outcome.
 *
 * Names stand in for ids throughout. Every line is a fact of the record; no
 * line says who played a fail card, which the record never holds. Talk that
 * speech-to-text was unsure of is marked "[unclear audio]".
 *
 * Names and talk are what players typed and said, so they go in as data
 * (`asData`): each on one line and without the marks the prompt fences the
 * record with, so none can pose as a line of the record or end its fence.
 */

import { SPECIAL_ROLES } from '@/lib/utils/constants';
import type { SpecialRole } from '@/types/database';
import type { ReviewGameRecord, ReviewRecordProposal, ReviewRecordTurn } from '@/types/review';

/** A seat's true role. A god record carries them; for a blind one the chat
 *  reads them from the game's role rows (plan D6). */
export interface ChatRole {
  id: string;
  role: 'good' | 'evil';
  special_role: SpecialRole | null;
}

const WIN_REASON: Record<string, string> = {
  '3_quest_successes': 'three quests succeeded',
  '3_quest_failures': 'three quests failed',
  '5_rejections': 'five proposals in a row were rejected',
  assassin_found_merlin: 'the Assassin found Merlin',
};

/** Text from the game — a name, talk, the report — without any run of three
 *  or more angle brackets, of which the prompt's fence marks are made; and,
 *  for a name or a turn's talk, on one line. */
export function asData(text: string, oneLine = false): string {
  const unfenced = text.replace(/[<>]{3,}/g, '');
  return oneLine ? unfenced.replace(/\s+/g, ' ').trim() : unfenced;
}

export function roleName(role: ChatRole): string {
  const special: SpecialRole = role.special_role ?? (role.role === 'evil' ? 'minion' : 'servant');
  return SPECIAL_ROLES[special]?.name ?? special;
}

export function recordText(record: ReviewGameRecord, roles: ChatRole[]): string {
  const nameById = new Map(record.players.map((p) => [p.id, asData(p.display_name, true)]));
  const name = (id: string) => nameById.get(id) ?? 'an unknown player';
  const names = (ids: string[]) => ids.map(name).join(', ') || 'no one';
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const lines: string[] = [];

  lines.push('PLAYERS (by seat; seat 1 led the first proposal, then clockwise)');
  for (const p of [...record.players].sort((a, b) => a.seat_number - b.seat_number)) {
    const role = roleById.get(p.id);
    lines.push(
      `- Seat ${p.seat_number}: ${name(p.id)} — ${role ? `${role.role}, ${roleName(role)}` : 'role unknown'}`
    );
  }

  const inPlay = [...new Set(roles.map((r) => r.special_role ?? (r.role === 'evil' ? 'minion' : 'servant')))];
  lines.push('', 'ROLES IN THIS GAME');
  for (const role of inPlay) {
    const info = SPECIAL_ROLES[role];
    if (info) lines.push(`- ${info.name} (${info.team}): ${info.description}`);
  }

  const said = (speakerId: string, transcript: string, lowConfidence: boolean) =>
    `    ${name(speakerId)}${lowConfidence ? ' [unclear audio]' : ''}: ` +
    (asData(transcript, true) || '(no words transcribed)');
  const talk = (turns: ReviewRecordTurn[]) =>
    turns.map((t) => said(t.speakerId, t.transcript, t.low_confidence));

  const intro = record.turns.filter((t) => t.quest === 0);
  if (intro.length > 0) lines.push('', 'INTRO ROUND (talk before quest 1)', ...talk(intro));

  const quests = [
    ...new Set([
      ...record.turns.map((t) => t.quest),
      ...record.proposals.map((p) => p.quest),
      ...record.missions.map((m) => m.quest),
    ]),
  ]
    .filter((q) => q > 0)
    .sort((a, b) => a - b);

  for (const quest of quests) {
    lines.push('', `QUEST ${quest}`);
    const proposals = record.proposals
      .filter((p) => p.quest === quest)
      .sort((a, b) => a.proposalNumber - b.proposalNumber);
    const turns = record.turns.filter((t) => t.quest === quest);

    for (const p of proposals) {
      const about = turns.filter((t) => t.proposalNumber === p.proposalNumber);
      if (about.length > 0) lines.push(`  Talk about proposal ${p.proposalNumber}:`, ...talk(about));
      lines.push(`  ${proposalLine(p, name, names)}`);
    }
    const numbers = new Set(proposals.map((p) => p.proposalNumber));
    const other = turns.filter((t) => t.proposalNumber === null || !numbers.has(t.proposalNumber));
    if (other.length > 0) lines.push('  Talk with no proposal after it:', ...talk(other));

    const mission = record.missions.find((m) => m.quest === quest);
    lines.push(
      mission
        ? `  Mission: team ${names(mission.teamIds)} — ${mission.result === 'success' ? 'succeeded' : 'failed'}, ` +
            `${mission.successCount} success card(s), ${mission.failCount} fail card(s)`
        : '  Mission: not played'
    );

    for (const l of record.lady.filter((u) => u.quest === quest)) {
      const seen = 'result' in l ? ` and saw ${l.result}` : '';
      lines.push(`  Lady of the Lake: ${name(l.investigatorId)} looked at ${name(l.targetId)}${seen}`);
    }
  }

  const discussion = record.discussion;
  if (discussion || record.assassinPickId) {
    lines.push('', 'ASSASSIN PHASE');
    if (discussion) {
      lines.push(
        `  Discussion before the pick (${Math.round(discussion.durationSec)} s):`,
        ...discussion.speakers
          .filter((s) => s.transcript.trim().length > 0)
          .map((s) => said(s.speakerId, s.transcript, s.low_confidence))
      );
    }
    if (record.assassinPickId) {
      const assassin = roles.find((r) => r.special_role === 'assassin');
      const who = assassin ? `The Assassin, ${name(assassin.id)},` : 'The Assassin';
      lines.push(`  ${who} named ${name(record.assassinPickId)} as Merlin.`);
    }
  }

  const outcome = record.outcome;
  lines.push(
    '',
    outcome?.winner
      ? `OUTCOME: ${outcome.winner} won — ${WIN_REASON[outcome.win_reason ?? ''] ?? outcome.win_reason ?? 'no reason recorded'}.`
      : 'OUTCOME: not recorded.'
  );

  return lines.join('\n');
}

function proposalLine(
  p: ReviewRecordProposal,
  name: (id: string) => string,
  names: (ids: string[]) => string
): string {
  const head = `Proposal ${p.proposalNumber}: leader ${name(p.leaderId)}, team ${names(p.teamIds)}`;
  if (p.status === 'pending') return `${head} — never voted on`;
  const approve = p.votes.filter((v) => v.vote === 'approve').map((v) => v.playerId);
  const reject = p.votes.filter((v) => v.vote === 'reject').map((v) => v.playerId);
  return (
    `${head} — ${p.status}, ${approve.length} approve to ${reject.length} reject ` +
    `(approve: ${names(approve)}; reject: ${names(reject)})`
  );
}
