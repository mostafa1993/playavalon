/**
 * The final report from the record: the record as the prompt reads it, and
 * the summary built around the model's answer. The model is a stub that
 * records what it was given.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient, PromptVars } from '@avalon/shared';
import {
  finalGuessesText,
  guessTimelineText,
  recordText,
  writeBlindReport,
  writeGodReport,
} from '../src/reviewer/finalReport.js';
import { summarizeRoleConfig } from '../src/gamestate/roleConfig.js';
import type { BlindGameRecord, GodGameRecord, GuessRound, RecordTurn } from '../src/types.js';

const at = (time: string) => `2026-01-01T${time}.000Z`;

const turn = (
  quest: number,
  round: number,
  idx: number,
  speakerId: string,
  transcript: string,
  proposalNumber: number | null
): RecordTurn => ({
  quest,
  round,
  turn: idx,
  speakerId,
  transcript,
  confidence: 0.9,
  startedAt: at('10:00:00'),
  durationSec: 30,
  proposalNumber,
});

const GOD: GodGameRecord = {
  gameId: 'g1',
  mode: 'god',
  cut: null,
  players: [
    { id: 'a', display_name: 'Ana', seat_number: 1, role: 'good', special_role: 'merlin' },
    { id: 'b', display_name: 'ٔBo', seat_number: 2, role: 'evil', special_role: 'assassin' },
    { id: 'c', display_name: 'Cy', seat_number: 3, role: 'good', special_role: 'servant' },
    { id: 'd', display_name: 'Di', seat_number: 4, role: 'evil', special_role: 'morgana' },
    { id: 'e', display_name: 'Ed', seat_number: 5, role: 'good', special_role: 'percival' },
  ],
  proposals: [
    {
      quest: 1,
      proposalNumber: 1,
      leaderId: 'a',
      teamIds: ['a', 'b'],
      status: 'rejected',
      votes: [
        { playerId: 'a', vote: 'approve' },
        { playerId: 'b', vote: 'approve' },
        { playerId: 'c', vote: 'reject' },
        { playerId: 'd', vote: 'reject' },
        { playerId: 'e', vote: 'reject' },
      ],
      createdAt: at('10:00:00'),
      resolvedAt: at('10:05:00'),
    },
    {
      quest: 1,
      proposalNumber: 2,
      leaderId: 'b',
      teamIds: ['b', 'c'],
      status: 'approved',
      votes: [
        { playerId: 'a', vote: 'reject' },
        { playerId: 'b', vote: 'approve' },
        { playerId: 'c', vote: 'approve' },
        { playerId: 'd', vote: 'approve' },
        { playerId: 'e', vote: 'reject' },
      ],
      createdAt: at('10:06:00'),
      resolvedAt: at('10:10:00'),
    },
    {
      quest: 2,
      proposalNumber: 1,
      leaderId: 'c',
      teamIds: ['c', 'd', 'e'],
      status: 'pending',
      votes: [],
      createdAt: at('10:20:00'),
      resolvedAt: null,
    },
  ],
  missions: [
    { quest: 1, teamIds: ['b', 'c'], successCount: 1, failCount: 1, result: 'fail', completedAt: at('10:11:00') },
  ],
  lady: [{ quest: 1, investigatorId: 'e', targetId: 'b', result: 'evil' }],
  assassinPickId: 'a',
  outcome: { winner: 'evil', win_reason: 'assassin_found_merlin', ended_at: at('10:40:00') },
  turns: [
    turn(0, 0, 0, 'a', 'سلام، من آنا هستم', null),
    turn(1, 0, 0, 'a', 'من بو را می‌برم', 1),
    turn(1, 0, 1, 'c', '', 1),
    turn(1, 1, 0, 'b', 'به سای اعتماد دارم', 2),
    turn(2, 0, 0, 'c', 'تیم من', 1),
  ],
  discussion: {
    startedAt: at('10:30:00'),
    durationSec: 120,
    speakers: [
      { speakerId: 'b', transcript: 'آنا مرلین است', confidence: 0.6, durationSec: 120 },
      { speakerId: 'd', transcript: '', confidence: null, durationSec: 120 },
    ],
  },
};

const BLIND: BlindGameRecord = {
  ...GOD,
  mode: 'blind',
  players: GOD.players.map(({ id, display_name, seat_number }) => ({ id, display_name, seat_number })),
  lady: GOD.lady.map(({ quest, investigatorId, targetId }) => ({ quest, investigatorId, targetId })),
};

test('the record reads in order: each proposal with its own leader, its talk and its vote', () => {
  const text = recordText(GOD);
  assert.equal(
    text,
    [
      'PLAYERS (seat: name — true role)',
      'seat 1: Ana — good (merlin)',
      'seat 2: ٔBo — evil (assassin)',
      'seat 3: Cy — good (servant)',
      'seat 4: Di — evil (morgana)',
      'seat 5: Ed — good (percival)',
      '',
      'INTRODUCTIONS (before quest 1)',
      'intro.1 Ana: سلام، من آنا هستم',
      '',
      'QUEST 1',
      'Proposal 1.1: leader Ana; team Ana, ٔBo',
      '  1.1.1 Ana: من بو را می‌برم',
      '  1.1.2 Cy: (no transcript)',
      '  Vote on proposal 1.1: approve Ana, ٔBo; reject Cy, Di, Ed → rejected',
      'Proposal 1.2: leader ٔBo; team ٔBo, Cy',
      '  1.2.1 ٔBo: به سای اعتماد دارم',
      '  Vote on proposal 1.2: approve ٔBo, Cy, Di; reject Ana, Ed → approved',
      'Mission 1: team ٔBo, Cy; 1 success, 1 fail → fail',
      'Lady of the Lake after quest 1: Ed looked at ٔBo and saw evil',
      '',
      'QUEST 2',
      'Proposal 2.1: leader Cy; team Cy, Di, Ed',
      '  2.1.1 Cy: تیم من',
      '  No vote on proposal 2.1: the game ended first',
      '',
      'ASSASSIN PHASE',
      'The discussion before the pick:',
      '  ٔBo: آنا مرلین است',
      "The assassin's pick (named as Merlin): Ana",
      '',
      'OUTCOME: evil won (assassin_found_merlin)',
    ].join('\n')
  );
});

test('the blind record reads with no role and no Lady result', () => {
  const text = recordText(BLIND);
  assert.match(text, /^PLAYERS \(seat: name\)\nseat 1: Ana\nseat 2: ٔBo\n/);
  assert.ok(!/ — (good|evil)|\((merlin|assassin|servant|morgana|percival)\)|saw (good|evil)/.test(text), text);
  assert.match(text, /Lady of the Lake after quest 1: Ed looked at ٔBo \(what Ed saw stayed private\)/);
  assert.match(text, /Vote on proposal 1\.2: approve ٔBo, Cy, Di; reject Ana, Ed → approved/);
});

test('talk in a quest that never had a proposal is kept, before any proposal', () => {
  const record: GodGameRecord = {
    ...GOD,
    proposals: [],
    missions: [],
    lady: [],
    turns: [turn(3, 0, 0, 'd', 'بحث', null)],
    discussion: null,
    assassinPickId: null,
    outcome: { winner: 'good', win_reason: '3_quest_successes', ended_at: null },
  };
  const text = recordText(record);
  assert.match(text, /QUEST 3\n3\.1\.1 Di: بحث\n\nOUTCOME: good won \(3_quest_successes\)$/);
  assert.ok(!text.includes('ASSASSIN PHASE'));
});

interface Call {
  file: string;
  vars: PromptVars;
}

function stub(answer: unknown) {
  const calls: Call[] = [];
  const llm: LLMClient = {
    runText: async () => {
      throw new Error('the report asks for JSON');
    },
    runJson: async <T>(file: string, vars: PromptVars) => {
      calls.push({ file, vars });
      return answer as T;
    },
  };
  return { llm, calls };
}

test('the god summary: the record without its talk, the commentary per quest, a note per player', async () => {
  const { llm, calls } = stub({
    narrative: '  روایت بازی  ',
    quests: [
      { quest: 2, commentary: 'دوم' },
      { quest: 1, commentary: 'اول' },
      { quest: 1, commentary: 'again' },
      { quest: 7, commentary: 'not a quest of this game' },
      { quest: 2, commentary: '' },
    ],
    performance: [
      { player: 'Ed', assessment: 'خوب' },
      { player: 'bo', assessment: 'زیرک' },
      { player: 'Zed', assessment: 'no such player' },
      { player: 'Ana', assessment: '' },
      { player: 'Ed', assessment: 'again' },
    ],
  });
  const summary = await writeGodReport(llm, GOD, 'ROOM01', 'fa');

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.file, 'report-god.yml');
  assert.deepEqual(Object.keys(calls[0]!.vars).sort(), ['language', 'record']);
  assert.equal(calls[0]!.vars.language, 'Persian (فارسی)');
  assert.equal(calls[0]!.vars.record, recordText(GOD));

  assert.equal(summary.format, 2);
  assert.equal(summary.mode, 'god');
  assert.equal(summary.language, 'fa');
  assert.equal(summary.gameId, 'g1');
  assert.equal(summary.roomCode, 'ROOM01');
  assert.equal(summary.narrative, 'روایت بازی');
  assert.deepEqual(summary.quest_commentary, [
    { quest: 1, commentary: 'اول' },
    { quest: 2, commentary: 'دوم' },
  ]);
  // Matched by name across case and marks, in seat order.
  assert.deepEqual(summary.performance, [
    { playerId: 'b', assessment: 'زیرک' },
    { playerId: 'e', assessment: 'خوب' },
  ]);
  // The facts are the record's own; the talk stays out of the summary.
  const { turns: _turns, cut: _cut, ...facts } = GOD;
  assert.deepEqual(summary.record, facts);
  assert.ok(!('turns' in summary.record));
});

test('the blind summary carries the detective\'s guesses and no role', async () => {
  const timeline: GuessRound[] = [
    {
      round: 1,
      quest: 0,
      proposal_round: 0,
      guesses: [{ player: 'Ana', guessed_role: 'Merlin', confidence: 'low', reasoning: 'آرام بود' }],
    },
    {
      round: 2,
      quest: 1,
      proposal_round: 1,
      guesses: [{ player: 'Ana', guessed_role: 'Loyal Servant', confidence: 'med', reasoning: 'رأی داد' }],
    },
  ];
  const { llm, calls } = stub({ narrative: 'story', quests: [{ quest: 1, commentary: 'c' }] });
  const summary = await writeBlindReport(
    llm,
    BLIND,
    {
      rolesInPlay: summarizeRoleConfig(5, { merlin: true, percival: true, morgana: true }),
      timeline,
      finalGuesses: timeline[1]!.guesses,
    },
    'ROOM01',
    'en'
  );

  assert.equal(calls[0]!.file, 'report-blind.yml');
  assert.deepEqual(Object.keys(calls[0]!.vars).sort(), [
    'final_guesses',
    'guess_timeline',
    'language',
    'record',
    'roles_in_play',
  ]);
  assert.equal(calls[0]!.vars.language, 'English');
  assert.match(calls[0]!.vars.roles_in_play as string, /Special roles in play: Merlin, Percival, Assassin, Morgana/);
  assert.equal(
    calls[0]!.vars.guess_timeline,
    'after the introductions: Ana Merlin (low)\nafter quest 1, round 2: Ana Loyal Servant (med)'
  );
  assert.equal(calls[0]!.vars.final_guesses, '- Ana: Loyal Servant (med) — رأی داد');

  assert.equal(summary.format, 2);
  assert.equal(summary.mode, 'blind');
  assert.deepEqual(summary.quest_commentary, [{ quest: 1, commentary: 'c' }]);
  assert.deepEqual(summary.guess_timeline, timeline);
  assert.deepEqual(summary.final_guesses, timeline[1]!.guesses);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes('special_role') && !text.includes('"result":"evil"'), 'the blind summary holds a role');
  assert.ok(!('performance' in summary));
});

test('the guesses read as "none yet" when the detective has none', () => {
  assert.equal(guessTimelineText([]), '(no reads recorded)');
  assert.equal(finalGuessesText([]), '(none)');
});

test('a report with no narrative fails', async () => {
  const { llm } = stub({ narrative: ' ', quests: [] });
  await assert.rejects(writeGodReport(llm, GOD, 'ROOM01', 'en'), /report-god\.yml returned no narrative/);
});
