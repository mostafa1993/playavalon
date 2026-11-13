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
import type { ExportedGame, ProposalRow } from '../src/gamestate/recordSource.js';
import type { GameLog } from '../src/pipeline.js';
import {
  GOD_RECORD_FILE,
  readInputs,
  replayMode,
  replayRun,
  type ReplayMode,
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
 *  and every derived file marked SHIPPED — the turn summaries of earlier
 *  services included. */
async function makeGodFolder(): Promise<string> {
  const dir = await tempDir();
  for (const [quest, round, turn, speaker, time] of TURNS) {
    const json: TurnJson & { summary: unknown } = {
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
      // One turn the recognizer was unsure of.
      confidence: label(quest, round, turn) === '1_1_1' ? 0.3 : 0.9,
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
      case 'role-guess-update.yml':
        return {
          guesses: [
            ['Ana', 'Merlin'],
            ['Ben', 'Percival'],
            ['Cy', 'Loyal Servant'],
            ['Dee', 'Assassin'],
            ['Eve', 'Morgana'],
          ].map(([player, guessed_role]) => ({
            player,
            guessed_role,
            confidence: 'low',
            reasoning: (vars.record as string).split('\n').at(-1),
          })),
        };
      case 'report-god.yml':
      case 'report-blind.yml':
        return {
          narrative: 'روایت',
          quests: [{ quest: 1, commentary: 'commentary' }],
          performance: [{ player: 'Ana', assessment: 'assessment' }],
        };
      case 'check-report.yml':
        return { statements: [] };
      case 'translate-report.yml': {
        const report = JSON.parse(vars.report as string) as {
          narrative: string;
          quests: Array<{ quest: number; commentary: string }>;
          performance: Array<{ player: string; assessment: string }>;
        };
        return {
          narrative: `English of ${report.narrative}`,
          quests: report.quests.map((q) => ({ ...q, commentary: `English of ${q.commentary}` })),
          performance: report.performance.map((p) => ({ ...p, assessment: `English of ${p.assessment}` })),
        };
      }
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
    lowConfidenceThreshold: 0.5,
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
      lowConfidenceThreshold: 0.5,
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
    for (const key of ['transcript', 'transcript_corrected', 'low_confidence']) {
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
  for (const file of ['summary.fa.json', 'summary.en.json', 'check.fa.json', 'record.json', GOD_RECORD_FILE]) {
    assert.ok(files.includes(file), `${file} written`);
  }
  assert.ok(!files.includes('guess_log.json'), 'no guess log in god mode');
});

test('god mode: the report reads the whole record, once, in Persian; the English is its translation', async () => {
  const { calls, read } = await replay('god');
  const turn = read('turn_1_0_0.json') as Record<string, unknown>;
  assert.equal(turn.transcript, 'fixed raw 1_0_0');
  assert.equal(turn.low_confidence, false);
  assert.equal((read('turn_1_1_1.json') as Record<string, unknown>).low_confidence, true);

  // The proofreader knows the table's names.
  const proofread = calls.filter((c) => c.file === 'correct-transcript.yml');
  assert.equal(proofread.length, TURNS.length + 1);
  for (const c of proofread) {
    assert.deepEqual((c.vars.players as string).split('\n').sort(), ['- Ana', '- Ben', '- Cy', '- Dee', '- Eve']);
  }

  const reports = calls.filter((c) => c.file === 'report-god.yml');
  assert.equal(reports.length, 1);
  const record = reports[0]!.vars.record as string;
  // Each proposal with its own leader, the talk under it, its vote; the
  // proofread talk; the discussion; the pick.
  assert.match(record, /Proposal 1\.1: leader Ana; team Ana, Ben\n  1\.1\.1 Ana: fixed raw 1_0_0\n  1\.1\.2 Ben: fixed raw 1_0_1\n  Vote on proposal 1\.1: approve Ana, Ben; reject Cy, Dee, Eve → rejected/);
  assert.match(record, /Proposal 1\.2: leader Ben; team Ben, Cy\n {2}1\.2\.1 Ben: fixed raw 1_1_0\n {2}1\.2\.2 Cy \[low confidence\]: fixed raw 1_1_1\n/);
  assert.match(record, /Ana — good \(merlin\)/);
  assert.match(record, /Eve: fixed raw discussion/);
  assert.match(record, /The assassin's pick \(named as Merlin\): Ana/);

  // The Persian report is checked against the record it was written from,
  // then translated.
  const checks = calls.filter((c) => c.file === 'check-report.yml');
  assert.equal(checks.length, 1);
  assert.match(checks[0]!.vars.record as string, /^\[1\] PLAYERS \(seat: name — true role\)\n/);
  assert.deepEqual(calls.slice(-2).map((c) => c.file), ['check-report.yml', 'translate-report.yml']);

  const summary = read('summary.fa.json') as Record<string, unknown>;
  assert.equal(summary.format, 2);
  assert.equal(summary.language, 'fa');
  assert.equal(summary.narrative, 'روایت');
  assert.deepEqual(summary.performance, [{ playerId: 'p1', assessment: 'assessment' }]);
  const english = read('summary.en.json') as Record<string, unknown>;
  assert.equal(english.language, 'en');
  assert.equal(english.narrative, 'English of روایت');
  assert.deepEqual(english.quest_commentary, [{ quest: 1, commentary: 'English of commentary' }]);
  assert.deepEqual(english.performance, [{ playerId: 'p1', assessment: 'English of assessment' }]);
  assert.deepEqual(english.record, summary.record);
});

test('the detective updates round by round, each from the public record cut at its round', async () => {
  const { calls, read } = await replay('blind');
  const updates = calls.filter((c) => c.file === 'role-guess-update.yml');
  const ends = [
    'SO FAR: the record ends after the introductions; the game goes on.',
    'SO FAR: the record ends after quest 1, round 1; the game goes on.',
    'SO FAR: the record ends after quest 1, round 2; the game goes on.',
    'SO FAR: the record ends after quest 2, round 1; the game goes on.',
  ];
  assert.deepEqual(updates.map((c) => (c.vars.record as string).split('\n').at(-1)), ends);
  const log = read('guess_log.json') as { rounds: Array<{ quest: number; proposal_round: number; guesses: Array<{ reasoning: string }> }> };
  assert.deepEqual(log.rounds.map((r) => [r.quest, r.proposal_round]), [[0, 0], [1, 0], [1, 1], [2, 0]]);
  assert.deepEqual(log.rounds.map((r) => r.guesses[0]!.reasoning), ends);

  // Each round's update read that round's proofread talk and its vote, and
  // nothing later: no later talk, no assassin phase, no outcome.
  const round10 = updates[1]!.vars.record as string;
  assert.match(round10, /1\.1\.1 Ana: fixed raw 1_0_0\n {2}1\.1\.2 Ben: fixed raw 1_0_1\n {2}Vote on proposal 1\.1: approve Ana, Ben; reject Cy, Dee, Eve → rejected/);
  assert.ok(!round10.includes('Proposal 1.2') && !round10.includes('raw 1_1_0'), round10);
  for (const c of updates) {
    const record = c.vars.record as string;
    assert.ok(!/ASSASSIN PHASE|OUTCOME|raw discussion/.test(record), record);
  }
  // The second quest's update has the first quest's mission.
  assert.match(updates[3]!.vars.record as string, /Mission 1: team Ben, Cy; 2 success, 0 fail → success/);

  // The scored read is the last, from before the assassin phase.
  const summary = read('summary.fa.json') as { final_guesses: Array<{ reasoning: string }> };
  assert.equal(summary.final_guesses[0]!.reasoning, ends[3]);
  const report = calls.find((c) => c.file === 'report-blind.yml');
  assert.match(report!.vars.final_guesses as string, /^- Ana: Merlin \(low\) — SO FAR: the record ends after quest 2, round 1/);
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
