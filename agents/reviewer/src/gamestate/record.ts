/**
 * The game record: every fact of a game, built in code from its rows and the
 * game folder's turn files, so no fact is carried by a model summary.
 *
 * It holds the roster and seats; each proposal with its leader, team, each
 * player's vote and its times; each mission's team and card counts; who used
 * Lady of the Lake on whom; the assassin's pick; the outcome; and every turn
 * and assassin-phase transcript, flagged when its confidence was low, each
 * turn joined to the proposal it was about.
 *
 * Per mode: a god record adds the roles and the Lady results. A blind record
 * holds public play only, and its build never asks the source for roles or
 * Lady results. No record holds who played a fail card.
 *
 * `cutRecord` gives the record so far, after any quest's round of talk.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { discussionPath } from '../storage/layout.js';
import type {
  DiscussionJson,
  GameRecord,
  GodRecordPlayer,
  RecordPlayer,
  RecordProposal,
  RecordTurn,
  TurnJson,
} from '../types.js';
import type {
  GameRow,
  PlayerRow,
  ProposalRow,
  RecordSource,
  RoleRow,
  VoteRow,
} from './recordSource.js';

const TURN_FILE = /^turn_(\d+)_(\d+)_(\d+)\.json$/;

/** `dir` is the game's folder, which holds its turn files and discussion. */
export async function buildGameRecord(
  source: RecordSource,
  dir: string,
  gameId: string,
  mode: 'god' | 'blind'
): Promise<GameRecord> {
  const game = await source.game();
  const [playerRows, unsortedProposals, turnFiles, discussion] = await Promise.all([
    source.players(game.seating_order),
    source.proposals(),
    loadTurnFiles(dir),
    loadDiscussion(dir),
  ]);
  const proposalRows = [...unsortedProposals].sort(
    (a, b) => a.quest_number - b.quest_number || a.proposal_number - b.proposal_number
  );

  // Votes are public once revealed, so a pending proposal's are not read.
  const voteRows = await source.votes(
    proposalRows.filter((p) => p.status !== 'pending').map((p) => p.id)
  );

  const players = buildRoster(game, playerRows, proposalRows);
  const proposals = buildProposals(proposalRows, voteRows, players);

  const common = {
    gameId,
    cut: null,
    proposals,
    missions: [...game.quest_results]
      .sort((a, b) => a.quest - b.quest)
      .map((r) => ({
        quest: r.quest,
        teamIds: r.team_member_ids,
        successCount: r.success_count,
        failCount: r.fail_count,
        result: r.result,
        completedAt: r.completed_at,
      })),
    assassinPickId: game.assassin_guess_id,
    outcome: { winner: game.winner, win_reason: game.win_reason, ended_at: game.ended_at },
    turns: turnFiles.map((f) => toRecordTurn(f, proposals)),
    discussion: discussion && {
      startedAt: discussion.startedAt,
      durationSec: discussion.durationSec,
      speakers: discussion.speakers.map((s) => ({
        speakerId: s.identity,
        transcript: s.transcript,
        confidence: s.confidence,
        low_confidence: s.low_confidence,
        durationSec: s.durationSec,
      })),
    },
  };

  if (mode === 'god') {
    const [roleRows, ladyRows] = await Promise.all([
      source.roles(game.room_id),
      source.ladyResults(),
    ]);
    return {
      mode: 'god',
      ...common,
      players: withRoles(players, roleRows),
      lady: [...ladyRows]
        .sort((a, b) => a.quest_number - b.quest_number)
        .map((l) => ({
          quest: l.quest_number,
          investigatorId: l.investigator_id,
          targetId: l.target_id,
          result: l.result,
        })),
    };
  }

  const ladyRows = await source.ladyUses();
  return {
    mode: 'blind',
    ...common,
    players,
    lady: [...ladyRows]
      .sort((a, b) => a.quest_number - b.quest_number)
      .map((l) => ({
        quest: l.quest_number,
        investigatorId: l.investigator_id,
        targetId: l.target_id,
      })),
  };
}

/**
 * The record so far once round `round` of quest `quest` ended: its talk and
 * everything before it, the proposal that talk led to with its vote, and —
 * when that proposal was approved — the quest's mission and Lady of the Lake,
 * which come before the next quest's talk. No assassin phase or outcome.
 */
export function cutRecord<R extends GameRecord>(record: R, quest: number, round: number): R {
  const turns = record.turns.filter(
    (t) => t.quest < quest || (t.quest === quest && t.round <= round)
  );
  const lastProposal = Math.max(
    0,
    ...turns.filter((t) => t.quest === quest).map((t) => t.proposalNumber ?? 0)
  );
  const proposals = record.proposals.filter(
    (p) => p.quest < quest || (p.quest === quest && p.proposalNumber <= lastProposal)
  );
  const questDone = proposals.some((p) => p.quest === quest && p.status === 'approved');
  const settled = (q: number) => q < quest || (q === quest && questDone);
  return {
    ...record,
    cut: { quest, round },
    proposals,
    missions: record.missions.filter((m) => settled(m.quest)),
    lady: record.lady.filter((l) => settled(l.quest)),
    assassinPickId: null,
    outcome: null,
    turns,
    discussion: null,
  };
}

interface TurnFile {
  quest: number;
  round: number;
  turn: number;
  json: TurnJson;
}

/** Every `turn_<quest>_<round>_<idx>.json` in the game folder, in that order. */
async function loadTurnFiles(dir: string): Promise<TurnFile[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const named = entries.flatMap((name) => {
    const m = TURN_FILE.exec(name);
    return m ? [{ name, quest: Number(m[1]), round: Number(m[2]), turn: Number(m[3]) }] : [];
  });
  named.sort((a, b) => a.quest - b.quest || a.round - b.round || a.turn - b.turn);
  return Promise.all(
    named.map(async ({ name, quest, round, turn }) => ({
      quest,
      round,
      turn,
      json: JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as TurnJson,
    }))
  );
}

/** The game folder's discussion.json; null when the game had no assassin-phase
 *  discussion (or its processing failed, which leaves no file). */
async function loadDiscussion(dir: string): Promise<DiscussionJson | null> {
  try {
    return JSON.parse(await fs.readFile(discussionPath(dir), 'utf8')) as DiscussionJson;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Seat 1 is the first leader, then clockwise around the seating order, as the
 *  game page numbers seats. The first leader led the first proposal. */
function buildRoster(
  game: GameRow,
  playerRows: PlayerRow[],
  proposalRows: ProposalRow[]
): RecordPlayer[] {
  const order = game.seating_order;
  const firstLeaderId = proposalRows[0]?.leader_id ?? game.current_leader_id;
  const firstLeaderIndex = order.indexOf(firstLeaderId);
  if (firstLeaderIndex < 0) throw new Error(`First leader ${firstLeaderId} is not seated`);
  const nameById = new Map(playerRows.map((p) => [p.id, p.display_name]));
  return order
    .map((id, i) => {
      const displayName = nameById.get(id);
      if (displayName === undefined) throw new Error(`No players row for seated player ${id}`);
      return {
        id,
        display_name: displayName,
        seat_number: ((i - firstLeaderIndex + order.length) % order.length) + 1,
      };
    })
    .sort((a, b) => a.seat_number - b.seat_number);
}

function buildProposals(
  proposalRows: ProposalRow[],
  voteRows: VoteRow[],
  players: RecordPlayer[]
): RecordProposal[] {
  const seatOf = new Map(players.map((p) => [p.id, p.seat_number]));
  return proposalRows.map((p) => ({
    quest: p.quest_number,
    proposalNumber: p.proposal_number,
    leaderId: p.leader_id,
    teamIds: p.team_member_ids,
    status: p.status,
    votes: voteRows
      .filter((v) => v.proposal_id === p.id)
      .sort((a, b) => (seatOf.get(a.player_id) ?? 0) - (seatOf.get(b.player_id) ?? 0))
      .map((v) => ({ playerId: v.player_id, vote: v.vote })),
    createdAt: p.created_at,
    resolvedAt: p.resolved_at,
  }));
}

function withRoles(players: RecordPlayer[], roleRows: RoleRow[]): GodRecordPlayer[] {
  const roleById = new Map(roleRows.map((r) => [r.player_id, r]));
  return players.map((p) => {
    const row = roleById.get(p.id);
    if (!row) throw new Error(`No player_roles row for ${p.id}`);
    return { ...p, role: row.role === 'evil' ? 'evil' : 'good', special_role: row.special_role };
  });
}

function toRecordTurn(
  { quest, round, turn, json }: TurnFile,
  proposals: RecordProposal[]
): RecordTurn {
  return {
    quest,
    round,
    turn,
    speakerId: json.speakerIdentity,
    transcript: json.transcript,
    confidence: json.confidence,
    low_confidence: json.low_confidence,
    startedAt: json.startedAt,
    durationSec: json.durationSec,
    proposalNumber: proposalFor(quest, json.startedAt, proposals),
  };
}

/**
 * The proposal a turn's talk was about: the first of its quest whose vote
 * closed after the turn started (the leader may start talking before the
 * proposal is made). Talk after the quest's last vote belongs to its latest
 * proposal.
 */
function proposalFor(quest: number, startedAt: string, proposals: RecordProposal[]): number | null {
  const ofQuest = proposals.filter((p) => p.quest === quest);
  const started = Date.parse(startedAt);
  const open = ofQuest.find((p) => p.resolvedAt === null || Date.parse(p.resolvedAt) > started);
  return (open ?? ofQuest.at(-1))?.proposalNumber ?? null;
}
