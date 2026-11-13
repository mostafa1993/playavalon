/**
 * The game record as the judge reads it: the god-mode `record.json` the
 * reviewer writes (agents/reviewer/src/gamestate/record.ts). Only the fields
 * the judge uses are typed here; the record is read as data, not imported.
 *
 * The judge always works from the god record — it needs the roles to score a
 * blind detective's guesses — whatever mode the judged report was written in.
 */

export interface JudgeRecord {
  gameId: string;
  mode: 'god';
  players: Array<{
    id: string;
    display_name: string;
    seat_number: number;
    role: 'good' | 'evil';
    special_role: string | null;
  }>;
  proposals: Array<{
    quest: number;
    proposalNumber: number;
    leaderId: string;
    teamIds: string[];
    status: string;
    votes: Array<{ playerId: string; vote: 'approve' | 'reject' }>;
  }>;
  missions: Array<{
    quest: number;
    teamIds: string[];
    successCount: number;
    failCount: number;
    result: string;
  }>;
  lady: Array<{ quest: number; investigatorId: string; targetId: string; result: string }>;
  assassinPickId: string | null;
  outcome: { winner: string | null; win_reason: string | null } | null;
  turns: Array<{
    quest: number;
    round: number;
    turn: number;
    speakerId: string;
    transcript: string;
    confidence: number | null;
    proposalNumber: number | null;
  }>;
  discussion: {
    speakers: Array<{ speakerId: string; transcript: string; confidence: number | null }>;
  } | null;
}

/** Parse and check a god record; throws on anything else. */
export function readRecord(raw: unknown): JudgeRecord {
  const r = raw as Partial<JudgeRecord>;
  if (!r || r.mode !== 'god' || !Array.isArray(r.players) || !Array.isArray(r.turns)) {
    throw new Error('The judge needs a god-mode record.json (with roles).');
  }
  return r as JudgeRecord;
}

/** The record as plain text with names, for the judge's prompt. */
export function recordText(rec: JudgeRecord): string {
  const name = new Map(rec.players.map((p) => [p.id, p.display_name]));
  const n = (id: string | null) => (id ? (name.get(id) ?? id) : 'nobody');
  const names = (ids: string[]) => ids.map(n).join(', ');
  const lines: string[] = [];

  lines.push('PLAYERS (seat: name — true role)');
  for (const p of [...rec.players].sort((a, b) => a.seat_number - b.seat_number)) {
    lines.push(`seat ${p.seat_number}: ${p.display_name} — ${p.role}${p.special_role ? ` (${p.special_role})` : ''}`);
  }

  lines.push('', 'PROPOSALS (quest.proposal: leader; team; votes; result)');
  for (const p of rec.proposals) {
    const yes = p.votes.filter((v) => v.vote === 'approve').map((v) => v.playerId);
    const no = p.votes.filter((v) => v.vote === 'reject').map((v) => v.playerId);
    lines.push(
      `Q${p.quest}.${p.proposalNumber}: leader ${n(p.leaderId)}; team ${names(p.teamIds)}; ` +
        `approve: ${names(yes) || 'nobody'}; reject: ${names(no) || 'nobody'}; ${p.status}`
    );
  }

  lines.push('', 'MISSIONS');
  for (const m of rec.missions) {
    lines.push(
      `Q${m.quest}: team ${names(m.teamIds)}; ${m.successCount} success, ${m.failCount} fail; ${m.result}`
    );
  }

  lines.push('', 'LADY OF THE LAKE (after quest: who looked at whom → what they saw)');
  if (rec.lady.length === 0) lines.push('none');
  for (const l of rec.lady) {
    lines.push(`after Q${l.quest}: ${n(l.investigatorId)} looked at ${n(l.targetId)} → ${l.result}`);
  }

  lines.push('', `ASSASSIN'S PICK: ${n(rec.assassinPickId)}`);
  lines.push(`OUTCOME: ${rec.outcome?.winner ?? 'unknown'} won (${rec.outcome?.win_reason ?? 'unknown'})`);

  lines.push(
    '',
    'TALK (quest.round.turn, each counted from 1 — round 1 of a quest is the talk about its first',
    'proposal; "intro" is the introductions before quest 1 — speaker, about proposal, STT confidence: transcript)'
  );
  for (const t of rec.turns) {
    // The record counts rounds and turns from 0; players count them from 1.
    const where = t.quest === 0 ? `intro.${t.turn + 1}` : `${t.quest}.${t.round + 1}.${t.turn + 1}`;
    const about = t.proposalNumber === null ? 'intro' : `proposal ${t.quest}.${t.proposalNumber}`;
    const conf = t.confidence === null ? '?' : t.confidence.toFixed(2);
    lines.push(`${where} ${n(t.speakerId)} (${about}, conf ${conf}): ${t.transcript || '(silent)'}`);
  }

  if (rec.discussion) {
    lines.push('', 'ASSASSIN-PHASE DISCUSSION (speaker, STT confidence: transcript)');
    for (const s of rec.discussion.speakers) {
      if (!s.transcript) continue;
      const conf = s.confidence === null ? '?' : s.confidence.toFixed(2);
      lines.push(`${n(s.speakerId)} (conf ${conf}): ${s.transcript}`);
    }
  }
  return lines.join('\n');
}
