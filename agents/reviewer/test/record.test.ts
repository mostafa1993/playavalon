/**
 * The game record: facts built in code from the rows and the turn files.
 *
 * The database stub keeps rows per table, applies `eq`/`in` filters, returns
 * only the selected columns, and records every query's table and columns —
 * so the blind tests can show that no role and no Lady result is ever asked
 * for, not just that none comes back.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildGameRecord, cutRecord } from '../src/gamestate/record.js';
import {
  dbRecordSource,
  exportRecordSource,
  readExportedGame,
} from '../src/gamestate/recordSource.js';
import type { DiscussionJson, GameRecord, TurnJson } from '../src/types.js';

type Row = Record<string, unknown>;

interface Query {
  table: string;
  columns: string[];
}

function makeDb(tables: Record<string, Row[]>, queries: Query[]): SupabaseClient {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let columns: string[] = [];
    const project = (r: Row) => Object.fromEntries(columns.map((c) => [c, r[c]]));
    const builder = {
      select(cols: string) {
        columns = cols.split(',').map((c) => c.trim());
        queries.push({ table, columns });
        return builder;
      },
      eq(col: string, value: unknown) {
        rows = rows.filter((r) => r[col] === value);
        return builder;
      },
      in(col: string, values: unknown[]) {
        rows = rows.filter((r) => values.includes(r[col]));
        return builder;
      },
      single() {
        return Promise.resolve({ data: rows.map(project)[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: rows.map(project), error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const GAME_ID = 'game-1';
const ROOM_ID = 'room-1';

// Seat 1 is the first leader (p1), then clockwise around the seating order.
const GAME: Row = {
  id: GAME_ID,
  room_id: ROOM_ID,
  seating_order: ['p3', 'p4', 'p5', 'p1', 'p2'],
  current_leader_id: 'p5',
  quest_results: [
    {
      quest: 2,
      result: 'fail',
      success_count: 2,
      fail_count: 1,
      team_member_ids: ['p3', 'p4', 'p5'],
      completed_at: '2026-01-01T10:16:30Z',
    },
    {
      quest: 1,
      result: 'success',
      success_count: 2,
      fail_count: 0,
      team_member_ids: ['p2', 'p3'],
      completed_at: '2026-01-01T10:10:30Z',
    },
    {
      quest: 3,
      result: 'success',
      success_count: 2,
      fail_count: 0,
      team_member_ids: ['p4', 'p1'],
      completed_at: '2026-01-01T10:25:30Z',
    },
  ],
  assassin_guess_id: 'p1',
  winner: 'evil',
  win_reason: 'assassin_found_merlin',
  ended_at: '2026-01-01T10:40:00Z',
};

const PLAYERS: Row[] = [
  { id: 'p1', display_name: 'Ana' },
  { id: 'p2', display_name: 'Ben' },
  { id: 'p3', display_name: 'Cy' },
  { id: 'p4', display_name: 'Dee' },
  { id: 'p5', display_name: 'Eve' },
];

const ROLES: Row[] = [
  { room_id: ROOM_ID, player_id: 'p1', role: 'good', special_role: 'merlin' },
  { room_id: ROOM_ID, player_id: 'p2', role: 'good', special_role: 'percival' },
  { room_id: ROOM_ID, player_id: 'p3', role: 'good', special_role: 'servant' },
  { room_id: ROOM_ID, player_id: 'p4', role: 'evil', special_role: 'assassin' },
  { room_id: ROOM_ID, player_id: 'p5', role: 'evil', special_role: 'morgana' },
];

function proposal(
  id: string,
  quest: number,
  number: number,
  leader: string,
  team: string[],
  status: string,
  createdAt: string,
  resolvedAt: string | null
): Row {
  return {
    id,
    game_id: GAME_ID,
    quest_number: quest,
    proposal_number: number,
    leader_id: leader,
    team_member_ids: team,
    status,
    created_at: `2026-01-01T${createdAt}Z`,
    resolved_at: resolvedAt && `2026-01-01T${resolvedAt}Z`,
  };
}

const PROPOSALS: Row[] = [
  proposal('q2p1', 2, 1, 'p3', ['p3', 'p4', 'p5'], 'approved', '10:12:00', '10:16:00'),
  proposal('q1p1', 1, 1, 'p1', ['p1', 'p2'], 'rejected', '10:00:00', '10:05:00'),
  proposal('q1p2', 1, 2, 'p2', ['p2', 'p3'], 'approved', '10:06:00', '10:10:00'),
  proposal('q3p1', 3, 1, 'p4', ['p4', 'p1'], 'approved', '10:20:00', '10:25:00'),
];

/** Votes per proposal, in an order unlike the seats. */
function votesFor(proposalId: string, approvers: string[]): Row[] {
  return ['p5', 'p2', 'p4', 'p1', 'p3'].map((p) => ({
    proposal_id: proposalId,
    player_id: p,
    vote: approvers.includes(p) ? 'approve' : 'reject',
  }));
}

const VOTES: Row[] = [
  ...votesFor('q1p1', ['p1', 'p2']),
  ...votesFor('q1p2', ['p1', 'p2', 'p3']),
  ...votesFor('q2p1', ['p3', 'p4', 'p5', 'p1']),
  ...votesFor('q3p1', ['p1', 'p2', 'p3', 'p4', 'p5']),
];

const LADY: Row[] = [
  {
    id: 'l1',
    game_id: GAME_ID,
    quest_number: 2,
    investigator_id: 'p5',
    target_id: 'p1',
    result: 'good',
    created_at: '2026-01-01T10:17:00Z',
  },
];

// Who played a fail card. No record may ever read it.
const QUEST_ACTIONS: Row[] = [
  { game_id: GAME_ID, quest_number: 2, player_id: 'p4', action: 'fail' },
];

function tables(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    games: [GAME],
    players: PLAYERS,
    player_roles: ROLES,
    team_proposals: PROPOSALS,
    votes: VOTES,
    lady_investigations: LADY,
    quest_actions: QUEST_ACTIONS,
    ...overrides,
  };
}

/** [file name, speaker, startedAt] — `turn_<quest>_<round>_<idx>`. */
const TURNS: Array<[string, string, string]> = [
  ['turn_0_0_0', 'p1', '09:50:00'], // the intro round
  ['turn_1_0_0', 'p1', '09:59:50'], // the leader talks before proposing
  ['turn_1_0_1', 'p3', '10:01:00'],
  ['turn_1_1_0', 'p2', '10:05:20'], // after the first vote, before the second proposal
  ['turn_1_1_1', 'p4', '10:07:00'],
  ['turn_2_0_0', 'p3', '10:12:10'],
  ['turn_2_0_1', 'p3', '10:16:20'], // after the quest's last vote
  ['turn_3_0_0', 'p4', '10:20:10'],
];

const tempDirs: string[] = [];
after(() => Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'record-test-'));
  tempDirs.push(dir);
  return dir;
}

/** The game's folder, with its turn files and discussion. */
async function makeFolder(): Promise<string> {
  const dir = path.join(await tempDir(), GAME_ID);
  await fs.mkdir(dir);
  for (const [name, speaker, time] of TURNS) {
    const [, quest, round, turn] = name.split('_').map(Number);
    const json: TurnJson = {
      gameId: GAME_ID,
      questNumber: quest!,
      roundIndex: round!,
      turnIndex: turn!,
      speakerIdentity: speaker,
      speakerDisplayName: speaker,
      startedAt: `2026-01-01T${time}.000Z`,
      durationSec: 50,
      sampleRate: 16000,
      transcript: `talk ${name}`,
      transcript_raw: `talk ${name}`,
      transcript_corrected: false,
      confidence: 0.9,
      low_confidence: false,
      language: 'fa-IR',
    };
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(json));
  }
  const discussion: DiscussionJson = {
    gameId: GAME_ID,
    startedAt: '2026-01-01T10:30:00.000Z',
    durationSec: 120,
    assassinIdentity: 'p4',
    assassinDisplayName: 'Dee',
    speakers: [
      {
        identity: 'p5',
        display_name: 'Eve',
        durationSec: 120,
        sampleRate: 16000,
        transcript: 'Ana is Merlin',
        transcript_raw: 'Ana is Merlin',
        transcript_corrected: false,
        confidence: 0.3,
        low_confidence: true,
      },
    ],
  };
  await fs.writeFile(path.join(dir, 'discussion.json'), JSON.stringify(discussion));
  return dir;
}

async function build(
  mode: 'god' | 'blind',
  overrides: Record<string, Row[]> = {}
): Promise<{ record: GameRecord; queries: Query[] }> {
  const queries: Query[] = [];
  const db = makeDb(tables(overrides), queries);
  const record = await buildGameRecord(
    dbRecordSource(db, GAME_ID),
    await makeFolder(),
    GAME_ID,
    mode
  );
  return { record, queries };
}

test('each proposal keeps its own leader, team, votes and times', async () => {
  const { record } = await build('god');
  assert.deepEqual(
    record.proposals.map((p) => [p.quest, p.proposalNumber, p.leaderId, p.teamIds, p.status]),
    [
      [1, 1, 'p1', ['p1', 'p2'], 'rejected'],
      [1, 2, 'p2', ['p2', 'p3'], 'approved'],
      [2, 1, 'p3', ['p3', 'p4', 'p5'], 'approved'],
      [3, 1, 'p4', ['p4', 'p1'], 'approved'],
    ]
  );
  const first = record.proposals[0]!;
  assert.deepEqual(first.votes, [
    { playerId: 'p1', vote: 'approve' },
    { playerId: 'p2', vote: 'approve' },
    { playerId: 'p3', vote: 'reject' },
    { playerId: 'p4', vote: 'reject' },
    { playerId: 'p5', vote: 'reject' },
  ]);
  assert.equal(first.createdAt, '2026-01-01T10:00:00Z');
  assert.equal(first.resolvedAt, '2026-01-01T10:05:00Z');
  assert.deepEqual(
    record.players.map((p) => [p.seat_number, p.id, p.display_name]),
    [
      [1, 'p1', 'Ana'],
      [2, 'p2', 'Ben'],
      [3, 'p3', 'Cy'],
      [4, 'p4', 'Dee'],
      [5, 'p5', 'Eve'],
    ]
  );
});

test('each turn joins the proposal its talk was about', async () => {
  const { record } = await build('god');
  assert.deepEqual(
    record.turns.map((t) => [t.quest, t.round, t.turn, t.speakerId, t.proposalNumber]),
    [
      [0, 0, 0, 'p1', null],
      [1, 0, 0, 'p1', 1],
      [1, 0, 1, 'p3', 1],
      [1, 1, 0, 'p2', 2],
      [1, 1, 1, 'p4', 2],
      [2, 0, 0, 'p3', 1],
      [2, 0, 1, 'p3', 1],
      [3, 0, 0, 'p4', 1],
    ]
  );
  assert.equal(record.turns[1]!.transcript, 'talk turn_1_0_0');
  assert.equal(record.discussion?.speakers[0]?.transcript, 'Ana is Merlin');
  // The turn files' low-confidence flags, as they were written.
  assert.ok(record.turns.every((t) => t.low_confidence === false));
  assert.equal(record.discussion?.speakers[0]?.low_confidence, true);
});

test('the god record holds the missions, the Lady result, the assassin pick and the outcome', async () => {
  const { record } = await build('god');
  assert.equal(record.mode, 'god');
  assert.deepEqual(
    record.missions.map((m) => [m.quest, m.teamIds, m.successCount, m.failCount, m.result]),
    [
      [1, ['p2', 'p3'], 2, 0, 'success'],
      [2, ['p3', 'p4', 'p5'], 2, 1, 'fail'],
      [3, ['p4', 'p1'], 2, 0, 'success'],
    ]
  );
  assert.deepEqual(record.lady, [
    { quest: 2, investigatorId: 'p5', targetId: 'p1', result: 'good' },
  ]);
  assert.equal(record.assassinPickId, 'p1');
  assert.deepEqual(record.outcome, {
    winner: 'evil',
    win_reason: 'assassin_found_merlin',
    ended_at: '2026-01-01T10:40:00Z',
  });
  if (record.mode !== 'god') return;
  assert.deepEqual(
    record.players.map((p) => [p.id, p.role, p.special_role]),
    [
      ['p1', 'good', 'merlin'],
      ['p2', 'good', 'percival'],
      ['p3', 'good', 'servant'],
      ['p4', 'evil', 'assassin'],
      ['p5', 'evil', 'morgana'],
    ]
  );
});

test('a game without Lady of the Lake has no Lady entries', async () => {
  for (const mode of ['god', 'blind'] as const) {
    const { record } = await build(mode, { lady_investigations: [] });
    assert.deepEqual(record.lady, []);
  }
});

test('a pending proposal: its votes are not read, and talk before its vote joins it', async () => {
  const pending = proposal('q4p1', 4, 1, 'p5', ['p5', 'p1', 'p2'], 'pending', '10:26:00', null);
  const queries: Query[] = [];
  const db = makeDb(
    tables({
      team_proposals: [...PROPOSALS, pending],
      votes: [...VOTES, ...votesFor('q4p1', ['p5'])],
    }),
    queries
  );
  const dir = await makeFolder();
  const turn: TurnJson = {
    gameId: GAME_ID,
    questNumber: 4,
    roundIndex: 0,
    turnIndex: 0,
    speakerIdentity: 'p5',
    speakerDisplayName: 'Eve',
    startedAt: '2026-01-01T10:26:10.000Z',
    durationSec: 50,
    sampleRate: 16000,
    transcript: 'my team',
    transcript_raw: 'my team',
    transcript_corrected: false,
    confidence: 0.9,
    low_confidence: false,
    language: 'fa-IR',
  };
  await fs.writeFile(path.join(dir, 'turn_4_0_0.json'), JSON.stringify(turn));
  const record = await buildGameRecord(dbRecordSource(db, GAME_ID), dir, GAME_ID, 'god');
  const last = record.proposals.at(-1)!;
  assert.equal(last.status, 'pending');
  assert.deepEqual(last.votes, []);
  assert.equal(record.turns.at(-1)?.proposalNumber, 1);
});

test('the record cut at quest 2 holds only what was public by then', async () => {
  const { record } = await build('god');
  const cut = cutRecord(record, 2, 0);
  assert.deepEqual(cut.cut, { quest: 2, round: 0 });
  assert.deepEqual(
    cut.turns.map((t) => [t.quest, t.round, t.turn]),
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 0],
      [1, 1, 1],
      [2, 0, 0],
      [2, 0, 1],
    ]
  );
  assert.deepEqual(
    cut.proposals.map((p) => [p.quest, p.proposalNumber]),
    [
      [1, 1],
      [1, 2],
      [2, 1],
    ]
  );
  // Quest 2's proposal was approved: its mission and Lady came before quest 3's talk.
  assert.deepEqual(
    cut.missions.map((m) => m.quest),
    [1, 2]
  );
  assert.deepEqual(
    cut.lady.map((l) => l.quest),
    [2]
  );
  assert.equal(cut.assassinPickId, null);
  assert.equal(cut.outcome, null);
  assert.equal(cut.discussion, null);
  assert.equal(cut.players.length, 5);

  // Mid-quest: the first rejected proposal and nothing after it.
  const early = cutRecord(record, 1, 0);
  assert.deepEqual(
    early.proposals.map((p) => [p.quest, p.proposalNumber]),
    [[1, 1]]
  );
  assert.deepEqual(early.missions, []);
  assert.deepEqual(early.lady, []);
});

test('blind: no player_roles or quest_actions query, no Lady result column', async () => {
  const { record, queries } = await build('blind');
  const tablesRead = queries.map((q) => q.table);
  assert.ok(!tablesRead.includes('player_roles'), 'BLIND MUST NEVER QUERY player_roles');
  assert.ok(!tablesRead.includes('quest_actions'), 'no record reads who played a fail card');
  const lady = queries.filter((q) => q.table === 'lady_investigations');
  assert.equal(lady.length, 1);
  assert.ok(!lady[0]!.columns.includes('result'), 'BLIND MUST NEVER SELECT the Lady result');
  assert.ok(
    queries.every((q) => !q.columns.includes('*')),
    'every query names its columns'
  );

  assert.equal(record.mode, 'blind');
  for (const p of record.players) {
    assert.deepEqual(Object.keys(p).sort(), ['display_name', 'id', 'seat_number']);
  }
  assert.deepEqual(record.lady, [{ quest: 2, investigatorId: 'p5', targetId: 'p1' }]);
  assert.ok(!JSON.stringify(record).includes('assassinIdentity'));
});

test('god mode reads the roles, never quest_actions', async () => {
  const { queries } = await build('god');
  const tablesRead = queries.map((q) => q.table);
  assert.ok(tablesRead.includes('player_roles'));
  assert.ok(!tablesRead.includes('quest_actions'), 'no record reads who played a fail card');
});

test('export source, blind: no role and no Lady result reach the record', async () => {
  const exportFile = path.join(await tempDir(), 'export.json');
  const exported = {
    // An exported games row carries private columns as well.
    game: { ...GAME, split_intel_certain_evil_ids: ['p2'], merlin_decoy_player_id: 'p3' },
    room: { id: ROOM_ID },
    players: PLAYERS,
    roles: ROLES,
    proposals: PROPOSALS,
    votes: VOTES,
    lady: LADY,
    events: [],
    review: null,
  };
  await fs.writeFile(exportFile, JSON.stringify([exported]));

  const source = exportRecordSource(await readExportedGame(exportFile, GAME_ID));
  assert.deepEqual(Object.keys(await source.game()).sort(), [
    'assassin_guess_id', 'current_leader_id', 'ended_at', 'id', 'quest_results',
    'room_id', 'seating_order', 'win_reason', 'winner',
  ]);
  assert.deepEqual(await source.ladyUses(), [
    { quest_number: 2, investigator_id: 'p5', target_id: 'p1' },
  ]);
  const blind = await buildGameRecord(source, await makeFolder(), GAME_ID, 'blind');
  for (const p of blind.players) {
    assert.deepEqual(Object.keys(p).sort(), ['display_name', 'id', 'seat_number']);
  }
  assert.deepEqual(blind.lady, [{ quest: 2, investigatorId: 'p5', targetId: 'p1' }]);
  const text = JSON.stringify(blind);
  for (const role of ['merlin', 'percival', 'servant', 'assassin', 'morgana']) {
    assert.ok(!text.includes(`"${role}"`), `blind record holds the role ${role}`);
  }
  assert.ok(!/"result":"(good|evil)"/.test(text), 'blind record holds a Lady result');

  // The same export in god mode carries both.
  const god = await buildGameRecord(source, await makeFolder(), GAME_ID, 'god');
  assert.deepEqual(god.lady, [{ quest: 2, investigatorId: 'p5', targetId: 'p1', result: 'good' }]);
  assert.equal(god.mode === 'god' && god.players[0]?.special_role, 'merlin');
});
