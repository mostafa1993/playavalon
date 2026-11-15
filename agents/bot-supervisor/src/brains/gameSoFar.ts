/**
 * The game so far, as one text for the smart bot's prompts: the game's public
 * history (every proposal, its leader and team, the revealed votes, every
 * quest's cards, the Lady of the Lake) with what was said placed where it was
 * said — the intro, then each quest's proposals each followed by the talk
 * about it and its vote.
 *
 * Talk is filed by the speaking timer's round (round r = the quest's proposal
 * r+1); a round with no proposal to put it under (one the timer counted that
 * the history doesn't have yet, or a count gone off) is shown on its own
 * rather than dropped.
 */

import type { GameHistory, HistoryProposal } from '../types/History.js';
import type { DiscussionLine, TalkTurn } from '../voice/talkMemory.js';

export interface GameSoFarInput {
  history: GameHistory | null;
  talk: readonly TalkTurn[];
  /** The assassin-phase discussion (evil players only), if any. */
  discussion?: readonly DiscussionLine[];
  players: ReadonlyArray<{ id: string; display_name: string }>;
  /** The bot's own player id: its name is marked "(you)". */
  meId: string;
}

export function renderGameSoFar(input: GameSoFarInput): string {
  const nameById = new Map(input.players.map((p) => [p.id, p.display_name]));
  const me = nameById.get(input.meId);
  const name = (id: string) => {
    const n = nameById.get(id) ?? 'an unknown player';
    return id === input.meId ? `${n} (you)` : n;
  };
  const speaker = (s: string) => (s === me ? `${s} (you)` : s);
  const names = (ids: readonly string[]) => ids.map(name).join(', ');
  const talkLines = (turns: readonly TalkTurn[], indent: string) =>
    turns.map((t) => `${indent}${speaker(t.speaker)}: ${t.text}`);

  const history = input.history ?? { proposals: [], quests: [], lady: [] };
  const lines: string[] = [];

  const intro = input.talk.filter((t) => t.quest === 0);
  if (intro.length > 0) {
    lines.push('Intro round (before quest 1):', ...talkLines(intro, '  '));
  }

  const questNumbers = new Set<number>([
    ...history.proposals.map((p) => p.quest),
    ...history.quests.map((q) => q.quest),
    ...input.talk.filter((t) => t.quest > 0).map((t) => t.quest),
  ]);
  for (const quest of [...questNumbers].sort((a, b) => a - b)) {
    lines.push(`Quest ${quest}:`);
    const proposals = history.proposals
      .filter((p) => p.quest === quest)
      .sort((a, b) => a.proposal_number - b.proposal_number);
    const talk = input.talk.filter((t) => t.quest === quest);

    for (const p of proposals) {
      lines.push(`  Proposal ${p.proposal_number}: ${name(p.leader_id)} (leader) proposed [${names(p.team_member_ids)}]`);
      const said = talk.filter((t) => t.round === p.proposal_number - 1);
      if (said.length > 0) lines.push('    Talk:', ...talkLines(said, '      '));
      lines.push(`    ${voteLine(p, names)}`);
    }

    const placed = new Set(proposals.map((p) => p.proposal_number - 1));
    const rounds = [...new Set(talk.map((t) => t.round))].filter((r) => !placed.has(r)).sort((a, b) => a - b);
    for (const r of rounds) {
      lines.push(`  Talk (round ${r + 1}, no proposal recorded for it yet):`, ...talkLines(talk.filter((t) => t.round === r), '    '));
    }

    const result = history.quests.find((q) => q.quest === quest);
    if (result) {
      lines.push(
        `  Quest result: ${result.result === 'success' ? 'SUCCESS' : 'FAIL'} — team [${names(result.team_member_ids)}]: ` +
          `${result.success_count} success, ${result.fail_count} fail card${result.fail_count === 1 ? '' : 's'}`
      );
    }
    for (const l of history.lady.filter((x) => x.quest === quest)) {
      const seen = l.result ? `: ${l.result.toUpperCase()} (only you know this)` : ' (only they know the result)';
      lines.push(`  Lady of the Lake: ${name(l.investigator_id)} looked at ${name(l.target_id)}${seen}`);
    }
  }

  const discussion = input.discussion ?? [];
  if (discussion.length > 0) {
    lines.push(
      'Assassin-phase discussion (the evil players, talking freely):',
      ...discussion.map((d) => `  ${speaker(d.speaker)}: ${d.text}`)
    );
  }

  return lines.length > 0 ? lines.join('\n') : '(nothing has happened yet)';
}

function voteLine(p: HistoryProposal, names: (ids: readonly string[]) => string): string {
  if (p.votes === null) return 'Vote: being cast now';
  const approve = p.votes.filter((v) => v.vote === 'approve').map((v) => v.player_id);
  const reject = p.votes.filter((v) => v.vote === 'reject').map((v) => v.player_id);
  return (
    `Vote: ${p.status === 'approved' ? 'APPROVED' : 'REJECTED'} — ` +
    `approve: ${approve.length ? names(approve) : 'nobody'}; reject: ${reject.length ? names(reject) : 'nobody'}`
  );
}
