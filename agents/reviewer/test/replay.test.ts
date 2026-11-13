/**
 * The replay: a stored game through every step after speech-to-text, as of
 * the time each step ran live, into a run folder that starts with the inputs
 * only. The model is a stub that answers each prompt and records what it was
 * given, so nothing here calls an LLM.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LLMClient, PromptVars } from '@avalon/shared';
import { exportProposalAt } from '../src/gamestate/gameReads.js';
import type { ExportedGame, ProposalRow } from '../src/gamestate/recordSource.js';
import type { GameLog } from '../src/pipeline.js';
import {
  GOD_RECORD_FILE,
  readInputs,
  replayMode,
  replayRun,
  type ReplayMode,
  turnProcessedAt,
} from '../src/replay.js';
import type { DiscussionJson, TurnJson } from '../src/types.js';

const GAME_ID = 'game-r';
const ROOM_ID = 'room-r';
const at = (time: string) => `2026-01-01T${time}.000Z`;

function proposal(
  id: string,
  quest: number,
  number: number,
  leader: string,
  team: string[],
  status: ProposalRow['status'],
  created: string,
  resolved: string | null
): ProposalRow {
  return {
    id,
    quest_number: quest,
    proposal_number: number,
    leader_id: leader,
    team_member_ids: team,
    status,
    created_at: at(created),
    resolved_at: resolved && at(resolved),
  };
}

const PROPOSALS: ProposalRow[] = [
  proposal('q2p1', 2, 1, 'p3', ['p3', 'p4', 'p5'], 'approved', '10:12:00', '10:16:00'),
  proposal('q1p1', 1, 1, 'p1', ['p1', 'p2'], 'rejected', '10:00:00', '10:05:00'),
  proposal('q1p2', 1, 2, 'p2', ['p2', 'p3'], 'approved', '10:06:00', '10:10:00'),
];

const votesFor = (proposalId: string, approvers: string[]) =>
  ['p1', 'p2', 'p3', 'p4', 'p5'].map((p) => ({
    proposal_id: proposalId,
    player_id: p,
    vote: approvers.includes(p) ? ('approve' as const) : ('reject' as const),
  }));

const ROLES = [
  ['p1', 'good', 'merlin'],
  ['p2', 'good', 'percival'],
  ['p3', 'good', 'servant'],
  ['p4', 'evil', 'assassin'],
  ['p5', 'evil', 'morgana'],
] as const;

function makeExport(mode: ReplayMode): ExportedGame {
  return {
    game: {
      id: GAME_ID,
      room_id: ROOM_ID,
      // The game's end: the lead has moved on from the first leader (p1).
      seating_order: ['p3', 'p4', 'p5', 'p1', 'p2'],
      current_leader_id: 'p4',
      quest_results: [
        {
          quest: 1,
          result: 'success',
          success_count: 2,
          fail_count: 0,
          team_member_ids: ['p2', 'p3'],
          completed_at: at('10:10:30'),
        },
        {
          quest: 2,
          result: 'fail',
          success_count: 2,
          fail_count: 1,
          team_member_ids: ['p3', 'p4', 'p5'],
          completed_at: at('10:16:30'),
        },
      ],
      assassin_guess_id: 'p1',
      winner: 'evil',
      win_reason: 'assassin_found_merlin',
      ended_at: at('10:30:00'),
      player_count: 5,
      created_at: at('09:45:00'),
    },
    room: { id: ROOM_ID, code: 'ROOM01', role_config: { merlin: true, percival: true, morgana: true }, ai_review_mode: mode },
    players: [
      { id: 'p1', display_name: 'Ana' },
      { id: 'p2', display_name: 'Ben' },
      { id: 'p3', display_name: 'Cy' },
      { id: 'p4', display_name: 'Dee' },
      { id: 'p5', display_name: 'Eve' },
    ],
    roles: ROLES.map(([player_id, role, special_role]) => ({ player_id, role, special_role })),
    proposals: PROPOSALS,
    votes: [
      ...votesFor('q1p1', ['p1', 'p2']),
      ...votesFor('q1p2', ['p1', 'p2', 'p3']),
      ...votesFor('q2p1', ['p3', 'p4', 'p5', 'p1']),
    ],
    lady: null,
  };
}

/** [quest, round, turn, speaker, startedAt] — 50 s each. */
const TURNS: Array<[number, number, number, string, string]> = [
  [0, 0, 0, 'p1', '09:50:00'], // the intro
  [1, 0, 0, 'p1', '09:59:00'], // the leader talks before proposing
  [1, 0, 1, 'p2', '10:00:30'],
  [1, 1, 0, 'p2', '10:05:10'], // ends 10:06:00, as the second proposal is made
  [1, 1, 1, 'p3', '10:07:00'],
  [2, 0, 0, 'p3', '10:11:00'], // ends before quest 2's proposal
  [2, 0, 1, 'p4', '10:12:30'],
];
const label = (q: number, r: number, i: number) => `${q}_${r}_${i}`;

const tempDirs: string[] = [];
after(() => Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-test-'));
  tempDirs.push(dir);
  return dir;
}

const SHIPPED = 'SHIPPED';
const writeJson = (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value));

/** A god-mode game folder as the live service left it: roles in meta.json,
 *  and every derived file marked SHIPPED. */
async function makeGodFolder(): Promise<string> {
  const dir = await tempDir();
  for (const [quest, round, turn, speaker, time] of TURNS) {
    const json: TurnJson = {
      gameId: GAME_ID,
      questNumber: quest,
      roundIndex: round,
      turnIndex: turn,
      speakerIdentity: speaker,
      speakerDisplayName: speaker,
      startedAt: at(time),
      durationSec: 50,
      sampleRate: 16000,
      transcript: `${SHIPPED} corrected`,
      transcript_raw: `raw ${label(quest, round, turn)}`,
      transcript_corrected: true,
      confidence: 0.9,
      language: 'fa-IR',
      summary: {
        key_points: [SHIPPED],
        claims: [],
        suspicions: [],
        defenses: [],
        stance: 'neutral',
        notable_quotes: [],
      },
    };
    await writeJson(path.join(dir, `turn_${label(quest, round, turn)}.json`), json);
  }
  const discussion: DiscussionJson = {
    gameId: GAME_ID,
    startedAt: at('10:20:00'),
    durationSec: 120,
    assassinIdentity: 'p4',
    assassinDisplayName: 'Dee',
    speakers: [
      {
        identity: 'p5',
        display_name: 'Eve',
        durationSec: 120,
        sampleRate: 16000,
        transcript: `${SHIPPED} corrected`,
        transcript_raw: 'raw discussion',
        transcript_corrected: true,
        confidence: 0.8,
        summary: {
          key_points: [SHIPPED],
          claims: [],
          suspicions: [],
          defenses: [],
          stance: 'neutral',
          notable_quotes: [],
        },
      },
    ],
  };
  await writeJson(path.join(dir, 'discussion.json'), discussion);
  await writeJson(path.join(dir, 'meta.json'), {
    gameId: GAME_ID,
    players: ROLES.map(([id, role, special_role]) => ({ id, display_name: id, role, special_role })),
    note: SHIPPED,
  });
  await writeJson(path.join(dir, 'dossier_p1.json'), { note: SHIPPED });
  await writeJson(path.join(dir, 'quest_1.json'), { note: SHIPPED });
  await writeJson(path.join(dir, 'guess_log.json'), { gameId: GAME_ID, updatedAt: SHIPPED, rounds: [] });
  await writeJson(path.join(dir, 'record.json'), { note: SHIPPED });
  for (const lang of ['fa', 'en']) {
    await writeJson(path.join(dir, `summary.${lang}.json`), { mode: 'god', note: SHIPPED });
  }
  return dir;
}

interface Call {
  file: string;
  vars: PromptVars;
}

/** Answers every prompt with a fixed shape and records each call. On its first
 *  call it also records what the run folder held. */
function stubLlm(runDir: () => string) {
  const calls: Call[] = [];
  let firstSeen: Record<string, string> | null = null;
  const answer = async (file: string, vars: PromptVars): Promise<unknown> => {
    if (!firstSeen) {
      firstSeen = Object.fromEntries(
        readdirSync(runDir()).map((f) => [f, readFileSync(path.join(runDir(), f), 'utf8')])
      );
    }
    calls.push({ file, vars });
    // Quest 1's first answer comes late, so later turns overtake it.
    if (file === 'correct-transcript.yml' && vars.raw_transcript === `raw ${label(1, 0, 1)}`) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    switch (file) {
      case 'correct-transcript.yml':
        return `fixed ${vars.raw_transcript}`;
      case 'turn-summarizer.yml':
        return {
          key_points: [`about ${vars.transcript}`],
          claims: [],
          suspicions: [],
          defenses: [],
          stance: 'neutral',
          notable_quotes: [],
        };
      case 'role-guess-update.yml':
        return {
          guesses: [
            {
              player: 'Ana',
              guessed_role: 'Loyal Servant',
              confidence: 'low',
              reasoning: `after ${vars.quest_number}/${vars.proposal_round}`,
            },
          ],
        };
      case 'report-god.yml':
      case 'report-blind.yml':
        return {
          narrative: `narrative in ${vars.language}`,
          quests: [{ quest: 1, commentary: 'commentary' }],
          performance: [{ player: 'Ana', assessment: 'assessment' }],
        };
      case 'check-report.yml':
        return { statements: [] };
      default:
        return `text from ${file}`;
    }
  };
  const llm: LLMClient = {
    runText: async (file, vars) => (await answer(file, vars)) as string,
    runJson: async <T>(file: string, vars: PromptVars) => (await answer(file, vars)) as T,
  };
  return { llm, calls, firstSeen: () => firstSeen };
}

const quietLog: GameLog = { info: () => {}, error: () => {} };

async function replay(mode: ReplayMode) {
  const sourceDir = await makeGodFolder();
  const runDir = path.join(await tempDir(), GAME_ID, mode, 'run-1');
  const stub = stubLlm(() => runDir);
  await replayRun({
    llm: stub.llm,
    correction: true,
    exported: makeExport('god'),
    sourceDir,
    runDir,
    mode,
    concurrency: 6,
    log: quietLog,
  });
  const read = (file: string) => JSON.parse(readFileSync(path.join(runDir, file), 'utf8'));
  return { runDir, read, ...stub };
}

test('turns are read in order of quest, round and turn', async () => {
  const dir = await tempDir();
  const names = ['10_0_0', '2_0_0', '1_0_10', '1_1_0', '1_0_2'];
  for (const name of names) {
    const [quest, round, turn] = name.split('_').map(Number);
    await writeJson(path.join(dir, `turn_${name}.json`), {
      gameId: GAME_ID,
      questNumber: quest,
      roundIndex: round,
      turnIndex: turn,
      speakerIdentity: 'p1',
      speakerDisplayName: 'Ana',
      startedAt: at('10:00:00'),
      durationSec: 1,
      sampleRate: 16000,
      transcript: 'x',
      transcript_raw: 'x',
      transcript_corrected: true,
      confidence: 1,
      language: 'fa-IR',
    });
  }
  const { turns, discussion } = await readInputs(dir);
  assert.deepEqual(
    turns.map((t) => `${t.questNumber}_${t.roundIndex}_${t.turnIndex}`),
    ['1_0_2', '1_0_10', '1_1_0', '2_0_0', '10_0_0']
  );
  assert.equal(discussion, null);
});

test('turn files without a round segment are refused, before any model call', async () => {
  const sourceDir = await makeGodFolder();
  await writeJson(path.join(sourceDir, 'turn_1_3.json'), { gameId: GAME_ID });
  await assert.rejects(readInputs(sourceDir), /without a round segment.*turn_1_3\.json/);

  const runDir = path.join(await tempDir(), 'run-1');
  const stub = stubLlm(() => runDir);
  await assert.rejects(
    replayRun({
      llm: stub.llm,
      correction: true,
      exported: makeExport('god'),
      sourceDir,
      runDir,
      mode: 'god',
      concurrency: 6,
      log: quietLog,
    }),
    /round segment/
  );
  assert.equal(stub.calls.length, 0);
  await assert.rejects(fs.access(runDir), 'nothing is written');
});

test("the mode: the game's, god for a summary without a mode key, or --mode", () => {
  assert.equal(replayMode(makeExport('god'), { mode: 'god' }), 'god');
  assert.equal(replayMode(makeExport('blind'), { mode: 'blind' }), 'blind');
  assert.equal(replayMode(makeExport('blind'), null), 'blind');
  // Reviewed before migration 025: the database reads blind, the report was god.
  assert.equal(replayMode(makeExport('blind'), { language: 'fa' }), 'god');
  assert.equal(replayMode(makeExport('blind'), { language: 'fa' }, 'blind'), 'blind');
  assert.equal(replayMode(makeExport('god'), { mode: 'god' }, 'blind'), 'blind');
  assert.equal(replayMode(makeExport('blind'), { mode: 'blind' }, 'god'), 'god');
});

test('the proposal a turn is summarized against is the latest made by its end', () => {
  const exported = makeExport('god');
  const proposalAt = (quest: number, time: string) =>
    exportProposalAt(exported, quest, new Date(at(time)));
  assert.equal(proposalAt(1, '09:59:59'), null);
  assert.deepEqual(proposalAt(1, '10:00:00'), { leaderId: 'p1', teamMemberIds: ['p1', 'p2'] });
  assert.deepEqual(proposalAt(1, '10:05:59'), { leaderId: 'p1', teamMemberIds: ['p1', 'p2'] });
  assert.deepEqual(proposalAt(1, '10:06:00'), { leaderId: 'p2', teamMemberIds: ['p2', 'p3'] });
  assert.deepEqual(proposalAt(1, '11:00:00'), { leaderId: 'p2', teamMemberIds: ['p2', 'p3'] });
  assert.equal(proposalAt(2, '10:11:59'), null);
  assert.equal(proposalAt(0, '11:00:00'), null);
});

test('a run folder starts with the inputs only', async () => {
  const { firstSeen, runDir } = await replay('god');
  const seen = firstSeen();
  assert.ok(seen, 'the model was called');
  assert.deepEqual(
    Object.keys(seen).sort(),
    ['discussion.json', 'meta.json', ...TURNS.map(([q, r, i]) => `turn_${label(q, r, i)}.json`)].sort()
  );
  for (const [file, text] of Object.entries(seen)) {
    assert.ok(!text.includes(SHIPPED), `${file} carries a shipped derived value`);
    if (!file.startsWith('turn_')) continue;
    const turn = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['transcript', 'transcript_corrected', 'summary']) {
      assert.ok(!(key in turn), `${file} has ${key}`);
    }
    assert.match(turn.transcript_raw as string, /^raw /);
  }
  const discussion = JSON.parse(seen['discussion.json']!) as { speakers: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(discussion.speakers[0]!).sort(), [
    'confidence', 'display_name', 'durationSec', 'identity', 'sampleRate', 'transcript_raw',
  ]);

  // Everything after it is the pipeline's own.
  const files = await fs.readdir(runDir);
  for (const file of files) {
    const text = await fs.readFile(path.join(runDir, file), 'utf8');
    assert.ok(!text.includes(SHIPPED), `${file} carries a shipped derived value`);
  }
  for (const file of ['summary.fa.json', 'summary.en.json', 'check.fa.json', 'check.en.json', 'record.json', GOD_RECORD_FILE]) {
    assert.ok(files.includes(file), `${file} written`);
  }
  assert.ok(!files.includes('guess_log.json'), 'no guess log in god mode');
});

test('blind mode: each turn is summarized against the proposal standing when the live service read it', async () => {
  // Read at the next speaker's start: a leader who talks before proposing
  // has proposed by then, as live saw it.
  const { calls } = await replay('blind');
  const grounding = calls
    .filter((c) => c.file === 'turn-summarizer.yml' && c.vars.quest_number !== 0)
    .map((c) => [`${c.vars.quest_number}_${c.vars.round_index}_${c.vars.turn_index}`, c.vars.leader_display_name, c.vars.proposed_team])
    .sort();
  assert.deepEqual(grounding, [
    ['1_0_0', 'Ana', 'Ana, Ben'],
    ['1_0_1', 'Ana', 'Ana, Ben'],
    ['1_1_0', 'Ben', 'Ben, Cy'],
    ['1_1_1', 'Ben', 'Ben, Cy'],
    ['2_0_0', 'Cy', 'Cy, Dee, Eve'],
    ['2_0_1', 'Cy', 'Cy, Dee, Eve'],
  ]);
  // The intro (quest 0) has no proposal; the assassin phase has no summary.
  const unproposed = calls.filter((c) => c.file === 'turn-summarizer.yml' && c.vars.quest_number === 0);
  assert.equal(unproposed.length, 1);
});

test('god mode: no turn summaries; the report reads the whole record, once per language', async () => {
  const { calls, read } = await replay('god');
  assert.ok(!calls.some((c) => c.file === 'turn-summarizer.yml'), 'nothing reads a god-mode turn summary');
  const turn = read('turn_1_0_0.json') as Record<string, unknown>;
  assert.equal(turn.transcript, 'fixed raw 1_0_0');
  assert.ok(!('summary' in turn));

  const reports = calls.filter((c) => c.file === 'report-god.yml');
  assert.deepEqual(reports.map((c) => c.vars.language).sort(), ['English', 'Persian (فارسی)']);
  const record = reports[0]!.vars.record as string;
  // Each proposal with its own leader, the talk under it, its vote; the
  // proofread talk; the discussion; the pick.
  assert.match(record, /Proposal 1\.1: leader Ana; team Ana, Ben\n  1\.1\.1 Ana: fixed raw 1_0_0\n  1\.1\.2 Ben: fixed raw 1_0_1\n  Vote on proposal 1\.1: approve Ana, Ben; reject Cy, Dee, Eve → rejected/);
  assert.match(record, /Proposal 1\.2: leader Ben; team Ben, Cy/);
  assert.match(record, /Ana — good \(merlin\)/);
  assert.match(record, /Eve: fixed raw discussion/);
  assert.match(record, /The assassin's pick \(named as Merlin\): Ana/);

  // Each report is checked against the record it was written from.
  const checks = calls.filter((c) => c.file === 'check-report.yml');
  assert.equal(checks.length, 2);
  for (const c of checks) assert.match(c.vars.record as string, /^\[1\] PLAYERS \(seat: name — true role\)\n/);

  const summary = read('summary.fa.json') as Record<string, unknown>;
  assert.equal(summary.format, 2);
  assert.equal(summary.narrative, 'narrative in Persian (فارسی)');
  assert.deepEqual(summary.performance, [{ playerId: 'p1', assessment: 'assessment' }]);
});

test('the detective updates round by round', async () => {
  const { calls, read } = await replay('blind');
  const rounds = [[0, 0], [1, 0], [1, 1], [2, 0]];
  assert.deepEqual(
    calls.filter((c) => c.file === 'role-guess-update.yml').map((c) => [c.vars.quest_number, c.vars.proposal_round]),
    rounds
  );
  const log = read('guess_log.json') as { rounds: Array<{ quest: number; proposal_round: number }> };
  assert.deepEqual(log.rounds.map((r) => [r.quest, r.proposal_round]), rounds);
  // Each round's update saw that round's summaries, all of them.
  const round10 = calls.find((c) => c.file === 'role-guess-update.yml' && c.vars.quest_number === 1 && c.vars.proposal_round === 0);
  assert.match(round10!.vars.round_talk as string, /fixed raw 1_0_0.*fixed raw 1_0_1/s);
});

test('a blind replay of a god-mode folder holds no role before the report', async () => {
  const { calls, read, runDir } = await replay('blind');
  const roleValue = /"(merlin|percival|servant|assassin|morgana)"/;

  const meta = read('meta.json') as { players: Array<Record<string, unknown>> };
  assert.deepEqual(
    meta.players.map((p) => Object.keys(p).sort()),
    meta.players.map(() => ['display_name', 'id', 'seat_number'])
  );
  assert.deepEqual(
    meta.players.map((p) => [p.seat_number, p.display_name]).sort(),
    [[1, 'Ana'], [2, 'Ben'], [3, 'Cy'], [4, 'Dee'], [5, 'Eve']]
  );

  const record = read('record.json') as { mode: string; players: Array<Record<string, unknown>> };
  assert.equal(record.mode, 'blind');
  for (const p of record.players) {
    assert.deepEqual(Object.keys(p).sort(), ['display_name', 'id', 'seat_number']);
  }
  for (const file of ['meta.json', 'record.json', 'summary.fa.json', 'summary.en.json']) {
    const text = readFileSync(path.join(runDir, file), 'utf8');
    assert.ok(!roleValue.test(text) && !text.includes('special_role'), `${file} holds a role`);
  }
  for (const { file, vars } of calls) {
    const text = JSON.stringify(vars);
    assert.ok(!roleValue.test(text) && !text.includes('special_role'), `${file} was given a role`);
  }
  const report = calls.find((c) => c.file === 'report-blind.yml');
  assert.ok(report, 'the blind report was written');
  assert.ok(!/ — (good|evil)/.test(report.vars.record as string), 'the blind report read a role');
  assert.match(report.vars.record as string, /Proposal 1\.1: leader Ana; team Ana, Ben/);
  assert.ok(!calls.some((c) => c.file === 'report-god.yml'));

  // The judge's god record is written last, beside it, with the roles.
  const god = read(GOD_RECORD_FILE) as { mode: string; players: Array<{ id: string; special_role: string }> };
  assert.equal(god.mode, 'god');
  assert.equal(god.players.find((p) => p.id === 'p1')?.special_role, 'merlin');
});

test('a turn is read as of the next speaker\'s start in its round, else its audio end', () => {
  const turn = (q: number, r: number, t: number, startedAt: string, durationSec = 10) =>
    ({ questNumber: q, roundIndex: r, turnIndex: t, startedAt, durationSec }) as never;
  const turns = [
    turn(1, 0, 0, '2026-01-01T10:00:00.000Z'),
    turn(1, 0, 1, '2026-01-01T10:00:30.000Z'),
    turn(1, 1, 0, '2026-01-01T10:05:00.000Z'),
  ];
  assert.equal(turnProcessedAt(turns, 0).toISOString(), '2026-01-01T10:00:30.000Z');
  // The round's last turn: no next speaker in its round, so its audio end.
  assert.equal(turnProcessedAt(turns, 1).toISOString(), '2026-01-01T10:00:40.000Z');
  assert.equal(turnProcessedAt(turns, 2).toISOString(), '2026-01-01T10:05:10.000Z');
});
