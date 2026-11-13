/**
 * The blind detective: each round's read from the public record cut at that
 * round, checked in code against the roster and the setup's roles and counts
 * and asked for once more on a break; the scored read taken before the
 * assassin phase; no resuming from an old guess log. The model is a stub that
 * records what it was given.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LLMClient, PromptVars } from '@avalon/shared';
import type { RecordSource } from '../src/gamestate/recordSource.js';
import { summarizeRoleConfig, type RolesInPlay } from '../src/gamestate/roleConfig.js';
import type { PipelineContext } from '../src/pipeline.js';
import { checkRead, GuessTracker } from '../src/reviewer/guessTracker.js';
import type { DiscussionJson, GameMetaSnapshot, RecordPlayer, TurnJson } from '../src/types.js';

const at = (time: string) => `2026-01-01T${time}.000Z`;

const PLAYERS: RecordPlayer[] = [
  { id: 'a', display_name: 'Ana', seat_number: 1 },
  { id: 'b', display_name: 'Bo', seat_number: 2 },
  { id: 'c', display_name: 'Cy', seat_number: 3 },
  { id: 'd', display_name: 'Di', seat_number: 4 },
  { id: 'e', display_name: 'Ed', seat_number: 5 },
];
const WITH_MERLIN = summarizeRoleConfig(5, { merlin: true, percival: true, morgana: true });
const NO_MERLIN = summarizeRoleConfig(5, { merlin: false });

const guess = (player: string, guessed_role: string) => ({
  player,
  guessed_role,
  confidence: 'med',
  reasoning: 'دلیل',
});
const read = (...pairs: Array<[string, string]>) => pairs.map(([p, r]) => guess(p, r));
const GOOD_READ = read(
  ['Ana', 'Merlin'],
  ['Bo', 'Assassin'],
  ['Cy', 'Loyal Servant'],
  ['Di', 'Morgana'],
  ['Ed', 'Percival']
);

test('a whole deal of the setup passes, with names and roles as the record and the setup write them', () => {
  const { guesses, problems } = checkRead(
    read(
      ['ed', 'percival'],
      ['Di', 'MORGANA'],
      ['Cy', 'servant'],
      ['ٔBo', 'Assassin'],
      ['Ana', 'Merlin']
    ),
    PLAYERS,
    WITH_MERLIN
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(
    guesses.map((g) => [g.player, g.guessed_role]),
    [
      ['Ana', 'Merlin'],
      ['Bo', 'Assassin'],
      ['Cy', 'Loyal Servant'],
      ['Di', 'Morgana'],
      ['Ed', 'Percival'],
    ]
  );
});

test('a role given twice breaks the counts', () => {
  const { problems } = checkRead(
    read(
      ['Ana', 'Merlin'],
      ['Bo', 'Assassin'],
      ['Cy', 'Merlin'],
      ['Di', 'Morgana'],
      ['Ed', 'Percival']
    ),
    PLAYERS,
    WITH_MERLIN
  );
  assert.deepEqual(problems, ['Merlin is given to 2 players (Ana, Cy); the setup has 1']);

  // Plain roles have counts too: this setup has one Loyal Servant.
  const servants = checkRead(
    read(
      ['Ana', 'Merlin'],
      ['Bo', 'Assassin'],
      ['Cy', 'Loyal Servant'],
      ['Di', 'Morgana'],
      ['Ed', 'Loyal Servant']
    ),
    PLAYERS,
    WITH_MERLIN
  );
  assert.deepEqual(servants.problems, [
    'Loyal Servant is given to 2 players (Cy, Ed); the setup has 1',
  ]);
});

test('a role not in play breaks the setup', () => {
  const { problems } = checkRead(
    read(
      ['Ana', 'Merlin'],
      ['Bo', 'Assassin'],
      ['Cy', 'Oberon'],
      ['Di', 'Morgana'],
      ['Ed', 'Percival']
    ),
    PLAYERS,
    WITH_MERLIN
  );
  assert.deepEqual(problems, ['Cy is guessed as "Oberon", which is not in play']);
});

test('a setup without Merlin has no Merlin and no Assassin to give', () => {
  const { problems } = checkRead(
    read(
      ['Ana', 'Merlin'],
      ['Bo', 'Assassin'],
      ['Cy', 'Loyal Servant'],
      ['Di', 'Minion'],
      ['Ed', 'Loyal Servant']
    ),
    PLAYERS,
    NO_MERLIN
  );
  assert.deepEqual(problems, [
    'Ana is guessed as "Merlin", which is not in play',
    'Bo is guessed as "Assassin", which is not in play',
  ]);
  const plain = checkRead(
    read(
      ['Ana', 'Loyal Servant'],
      ['Bo', 'Minion of Mordred'],
      ['Cy', 'Loyal Servant'],
      ['Di', 'Minion'],
      ['Ed', 'Loyal Servant']
    ),
    PLAYERS,
    NO_MERLIN
  );
  assert.deepEqual(plain.problems, []);
  assert.equal(plain.guesses[1]!.guessed_role, 'Minion');
});

test('every player is guessed once, and no one else', () => {
  const { problems, guesses } = checkRead(
    read(
      ['Ana', 'Merlin'],
      ['Ana', 'Percival'],
      ['Zed', 'Assassin'],
      ['Di', 'Morgana'],
      ['Ed', 'Percival']
    ),
    PLAYERS,
    WITH_MERLIN
  );
  assert.deepEqual(problems, [
    'Ana is guessed more than once',
    '"Zed" is not a player of this game',
    'Bo has no guess',
    'Cy has no guess',
  ]);
  assert.deepEqual(
    guesses.map((g) => g.player),
    ['Ana', 'Di', 'Ed']
  );
  // Without a setup, only the roster is checked.
  assert.deepEqual(checkRead(read(['Ana', 'Whatever']), PLAYERS.slice(0, 1), null).problems, []);
});

// ── The tracker over a game folder ──────────────────────────────────────────

const tempDirs: string[] = [];
after(() => Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

const TELLING = 'من آدمکشم و دی هم با من است';

/** A finished game's folder: talk in the intro and two rounds of quest 1,
 *  and an assassin-phase discussion in which the evil players speak. */
async function gameFolder(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guess-test-'));
  tempDirs.push(dir);
  const turns: Array<[number, number, number, string, string]> = [
    [0, 0, 0, 'a', '09:50:00'],
    [1, 0, 0, 'a', '10:00:00'],
    [1, 0, 1, 'b', '10:01:00'],
    [1, 1, 0, 'b', '10:06:00'],
  ];
  for (const [quest, round, turn, speaker, time] of turns) {
    const json: TurnJson = {
      gameId: 'g1',
      questNumber: quest,
      roundIndex: round,
      turnIndex: turn,
      speakerIdentity: speaker,
      speakerDisplayName: speaker,
      startedAt: at(time),
      durationSec: 30,
      sampleRate: 16000,
      transcript: `talk ${quest}_${round}_${turn}`,
      transcript_raw: `raw ${quest}_${round}_${turn}`,
      transcript_corrected: true,
      confidence: 0.9,
      low_confidence: false,
      language: 'fa-IR',
    };
    await fs.writeFile(path.join(dir, `turn_${quest}_${round}_${turn}.json`), JSON.stringify(json));
  }
  const discussion: DiscussionJson = {
    gameId: 'g1',
    startedAt: at('10:20:00'),
    durationSec: 120,
    assassinIdentity: 'b',
    assassinDisplayName: 'Bo',
    speakers: [
      {
        identity: 'b',
        display_name: 'Bo',
        durationSec: 120,
        sampleRate: 16000,
        transcript: TELLING,
        transcript_raw: TELLING,
        transcript_corrected: true,
        confidence: 0.9,
        low_confidence: false,
      },
    ],
  };
  await fs.writeFile(path.join(dir, 'discussion.json'), JSON.stringify(discussion));
  // A guess log from an earlier session: never read back.
  await fs.writeFile(
    path.join(dir, 'guess_log.json'),
    JSON.stringify({
      gameId: 'g1',
      updatedAt: at('10:00:00'),
      rounds: [{ round: 7, quest: 1, proposal_round: 0, guesses: GOOD_READ }],
    })
  );
  return dir;
}

/** The game's public rows; the private ones are never asked for. */
const SOURCE: RecordSource = {
  game: async () => ({
    id: 'g1',
    room_id: 'r1',
    seating_order: ['a', 'b', 'c', 'd', 'e'],
    current_leader_id: 'c',
    quest_results: [
      {
        quest: 1,
        result: 'success',
        success_count: 2,
        fail_count: 0,
        team_member_ids: ['b', 'c'],
        completed_at: at('10:11:00'),
      },
    ],
    assassin_guess_id: 'a',
    winner: 'evil',
    win_reason: 'assassin_found_merlin',
    ended_at: at('10:25:00'),
  }),
  players: async (ids) =>
    PLAYERS.filter((p) => ids.includes(p.id)).map(({ id, display_name }) => ({ id, display_name })),
  proposals: async () => [
    {
      id: 'p1',
      quest_number: 1,
      proposal_number: 1,
      leader_id: 'a',
      team_member_ids: ['a', 'b'],
      status: 'rejected',
      created_at: at('10:00:30'),
      resolved_at: at('10:05:00'),
    },
    {
      id: 'p2',
      quest_number: 1,
      proposal_number: 2,
      leader_id: 'b',
      team_member_ids: ['b', 'c'],
      status: 'approved',
      created_at: at('10:06:30'),
      resolved_at: at('10:10:00'),
    },
  ],
  votes: async (ids) =>
    ids.flatMap((proposal_id) =>
      PLAYERS.map((p) => ({
        proposal_id,
        player_id: p.id,
        vote: p.id === 'd' ? ('reject' as const) : ('approve' as const),
      }))
    ),
  ladyUses: async () => [],
  roles: async () => {
    throw new Error('the detective read the roles');
  },
  ladyResults: async () => {
    throw new Error('the detective read a Lady result');
  },
};

interface Call {
  file: string;
  vars: PromptVars;
}

/** Answers each guess update from `answers` in turn. */
function stubLlm(answers: unknown[]) {
  const calls: Call[] = [];
  const llm: LLMClient = {
    runText: async () => {
      throw new Error('the detective asks for JSON');
    },
    runJson: async <T>(file: string, vars: PromptVars) => {
      calls.push({ file, vars });
      const answer = answers[calls.length - 1];
      if (answer instanceof Error) throw answer;
      return { guesses: answer } as T;
    },
  };
  return { llm, calls };
}

async function tracker(answers: unknown[], rolesInPlay: RolesInPlay | null = WITH_MERLIN) {
  const dir = await gameFolder();
  const { llm, calls } = stubLlm(answers);
  const meta: GameMetaSnapshot = {
    gameId: 'g1',
    roomId: 'r1',
    roomCode: 'ROOM01',
    playerCount: 5,
    startedAt: at('09:45:00'),
    seatingOrder: ['a', 'b', 'c', 'd', 'e'],
    firstLeaderId: 'a',
    players: PLAYERS,
    rolesInPlay,
  };
  const errors: string[] = [];
  const ctx: PipelineContext = {
    llm,
    correction: false,
    lowConfidenceThreshold: 0.5,
    gameId: 'g1',
    dir,
    mode: 'blind',
    meta,
    log: { info: () => {}, error: (msg) => errors.push(msg) },
  };
  return { guessTracker: new GuessTracker(ctx, SOURCE), calls, errors, dir };
}

test('each round reads the record cut at it; the scored read is from before the assassin phase', async () => {
  const reads = [
    GOOD_READ,
    GOOD_READ.map((g) => ({ ...g, confidence: 'high' })),
    GOOD_READ.map((g) => ({ ...g, reasoning: 'آخر' })),
  ];
  const { guessTracker, calls, errors, dir } = await tracker(reads);
  for (const [quest, round] of [
    [0, 0],
    [1, 0],
    [1, 1],
  ] as const)
    await guessTracker.updateForRound(quest, round);

  assert.deepEqual(errors, []);
  assert.equal(calls.length, 3);
  const records = calls.map((c) => c.vars.record as string);
  assert.match(
    records[0]!,
    /INTRODUCTIONS \(before quest 1\)\nintro\.1 Ana: <talk>talk 0_0_0<\/talk>\n\nSO FAR: the record ends after the introductions; the game goes on\.$/
  );
  assert.match(
    records[1]!,
    /Proposal 1\.1: leader Ana; team Ana, Bo\n {2}1\.1\.1 Ana: <talk>talk 1_0_0<\/talk>\n {2}1\.1\.2 Bo: <talk>talk 1_0_1<\/talk>\n {2}Vote on proposal 1\.1: approve Ana, Bo, Cy, Ed; reject Di → rejected/
  );
  assert.ok(!records[1]!.includes('Proposal 1.2') && !records[1]!.includes('Mission 1'));
  assert.match(
    records[2]!,
    /Proposal 1\.2: leader Bo; team Bo, Cy\n {2}1\.2\.1 Bo: <talk>talk 1_1_0<\/talk>\n {2}Vote on proposal 1\.2: .* → approved\nMission 1: team Bo, Cy; 2 success, 0 fail → success/
  );
  for (const record of records) {
    assert.ok(!record.includes(TELLING), 'the detective read the assassin-phase discussion');
    assert.ok(!/ASSASSIN PHASE|assassin's pick|OUTCOME|won/.test(record), record);
    assert.ok(!/ — (good|evil)|merlin|morgana/i.test(record), 'the detective read a role');
  }
  assert.match(
    calls[0]!.vars.roles_in_play as string,
    /good: Merlin 1, Percival 1, Loyal Servant 1; evil: Assassin 1, Morgana 1\./
  );

  // Each read is made afresh from the record: no read before it, and nothing
  // from the old log.
  assert.ok(
    calls.every((c) => Object.keys(c.vars).sort().join() === 'recheck,record,roles_in_play')
  );
  assert.ok(calls.every((c) => c.vars.recheck === ''));
  assert.ok(!records.some((r) => r.includes('دلیل')), 'a read before reached the detective');

  const timeline = guessTracker.getTimeline();
  assert.deepEqual(
    timeline.map((r) => [r.round, r.quest, r.proposal_round]),
    [
      [1, 0, 0],
      [2, 1, 0],
      [3, 1, 1],
    ]
  );
  assert.deepEqual(guessTracker.scoredRead(), timeline[2]!.guesses);
  assert.equal(guessTracker.scoredRead()[0]!.reasoning, 'آخر');
  const log = JSON.parse(await fs.readFile(path.join(dir, 'guess_log.json'), 'utf8')) as {
    rounds: unknown[];
  };
  assert.equal(log.rounds.length, 3);
});

test('a read that breaks the setup is asked for once more, with what broke', async () => {
  const twoMerlins = GOOD_READ.map((g) =>
    g.player === 'Cy' ? { ...g, guessed_role: 'Merlin' } : g
  );
  const { guessTracker, calls, errors } = await tracker([twoMerlins, GOOD_READ]);
  await guessTracker.updateForRound(0, 0);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.vars.recheck, '');
  assert.equal(
    calls[1]!.vars.recheck,
    '\nYOUR LAST ANSWER FOR THIS ROUND BROKE THE SETUP:\n' +
      '- Merlin is given to 2 players (Ana, Cy); the setup has 1\n' +
      'Answer again with a read that keeps to it.\n'
  );
  assert.equal(calls[1]!.vars.record, calls[0]!.vars.record);
  assert.deepEqual(
    guessTracker.scoredRead().map((g) => g.guessed_role),
    ['Merlin', 'Assassin', 'Loyal Servant', 'Morgana', 'Percival']
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /breaks the setup .*asking again/);
});

test('a second break, or a failed call, keeps the read before', async () => {
  const twoMerlins = GOOD_READ.map((g) =>
    g.player === 'Cy' ? { ...g, guessed_role: 'Merlin' } : g
  );
  const { guessTracker, calls, errors } = await tracker([
    twoMerlins,
    twoMerlins,
    GOOD_READ,
    twoMerlins,
    twoMerlins,
    new Error('model down'),
  ]);
  await guessTracker.updateForRound(0, 0); // two breaks, nothing before: no read
  assert.deepEqual(guessTracker.getTimeline(), []);
  await guessTracker.updateForRound(1, 0); // a good read
  await guessTracker.updateForRound(1, 1); // two breaks: the read before is kept
  await guessTracker.updateForRound(2, 0); // the call fails: the read before is kept

  assert.equal(calls.length, 6);
  const timeline = guessTracker.getTimeline();
  assert.deepEqual(
    timeline.map((r) => [r.quest, r.proposal_round]),
    [
      [1, 0],
      [1, 1],
      [2, 0],
    ]
  );
  for (const r of timeline)
    assert.deepEqual(r.guesses, checkRead(GOOD_READ, PLAYERS, WITH_MERLIN).guesses);
  assert.ok(errors.some((e) => /keeping the read before/.test(e)));
  assert.ok(errors.some((e) => /the call failed/.test(e)));
});
