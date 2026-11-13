/**
 * The report's check: statements tied to the record's numbered lines, the
 * flagged ones rewritten once and kept in the report, and a clean report left
 * as written with no rewrite call. The model is a stub that records what it
 * was given.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient, PromptVars } from '@avalon/shared';
import {
  checkReport,
  joinStatements,
  numberedRecord,
  readCheck,
  splitStatements,
} from '../src/reviewer/checkReport.js';
import { recordText } from '../src/reviewer/finalReport.js';
import type { GodGameRecord, GodSummaryJson } from '../src/types.js';

const at = (time: string) => `2026-01-01T${time}.000Z`;

const RECORD: GodGameRecord = {
  gameId: 'g1',
  mode: 'god',
  cut: null,
  players: [
    { id: 'a', display_name: 'Ana', seat_number: 1, role: 'good', special_role: 'merlin' },
    { id: 'b', display_name: 'Bo', seat_number: 2, role: 'evil', special_role: 'assassin' },
    { id: 'c', display_name: 'Cy', seat_number: 3, role: 'good', special_role: null },
  ],
  proposals: [
    {
      quest: 1,
      proposalNumber: 1,
      leaderId: 'a',
      teamIds: ['a', 'b'],
      status: 'approved',
      votes: [
        { playerId: 'a', vote: 'approve' },
        { playerId: 'b', vote: 'approve' },
        { playerId: 'c', vote: 'reject' },
      ],
      createdAt: at('10:00:00'),
      resolvedAt: at('10:05:00'),
    },
  ],
  missions: [
    {
      quest: 1,
      teamIds: ['a', 'b'],
      successCount: 1,
      failCount: 1,
      result: 'fail',
      completedAt: at('10:06:00'),
    },
  ],
  lady: [],
  assassinPickId: 'a',
  outcome: { winner: 'evil', win_reason: 'assassin_found_merlin', ended_at: at('10:30:00') },
  turns: [
    {
      quest: 1,
      round: 0,
      turn: 0,
      speakerId: 'a',
      transcript: 'بو را می‌برم',
      confidence: 0.9,
      low_confidence: false,
      startedAt: at('10:00:00'),
      durationSec: 30,
      proposalNumber: 1,
    },
  ],
  discussion: null,
};

const SUMMARY: GodSummaryJson = {
  format: 2,
  mode: 'god',
  language: 'fa',
  gameId: 'g1',
  roomCode: 'ROOM01',
  generatedAt: at('11:00:00'),
  narrative:
    'آنا تیم را چید. بو در تیم بود؟ سای مخالفت کرد.\n\nماموریت شکست خورد! بو کارت شکست زد.',
  quest_commentary: [{ quest: 1, commentary: 'رهبر ماموریت اول سای بود. رأی‌ها نزدیک بود.' }],
  record: (({ turns: _t, cut: _c, ...facts }) => facts)(RECORD),
  performance: [
    { playerId: 'a', assessment: 'آنا خوب بازی کرد.' },
    { playerId: 'b', assessment: 'بو گفت مرلین است.' },
  ],
};

interface Call {
  file: string;
  vars: PromptVars;
}

function stub(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const llm: LLMClient = {
    runText: async () => {
      throw new Error('the check asks for JSON');
    },
    runJson: async <T>(file: string, vars: PromptVars) => {
      calls.push({ file, vars });
      if (!(file in answers)) throw new Error(`unexpected prompt ${file}`);
      return answers[file] as T;
    },
  };
  return { llm, calls };
}

const ok = (id: number, kind: string, lines: number[] = []) => ({
  id,
  kind,
  lines,
  verdict: 'ok',
  problem: '',
});

test('statements split at sentence ends and line breaks, and join back as they were', () => {
  const text = 'آنا تیم را چید. بو در تیم بود؟ سای مخالفت کرد.\n\nماموریت شکست خورد! آخر';
  const pieces = splitStatements(text);
  assert.deepEqual(
    pieces.map((p) => p.text),
    ['آنا تیم را چید.', 'بو در تیم بود؟', 'سای مخالفت کرد.', 'ماموریت شکست خورد!', 'آخر']
  );
  const numbered = pieces.map((p, i) => ({ id: i + 1, ...p }));
  assert.equal(joinStatements(numbered, new Map()), text);
  // A removed statement keeps the paragraph break after it.
  assert.equal(
    joinStatements(
      numbered,
      new Map([
        [3, ''],
        [5, 'پایان.'],
      ])
    ),
    'آنا تیم را چید. بو در تیم بود؟\n\nماموریت شکست خورد! پایان.'
  );
});

test("the record's lines are numbered, blank lines aside", () => {
  const { text, lines } = numberedRecord('PLAYERS\nseat 1: Ana\n\nQUEST 1\n  1.1.1 Ana: hi');
  assert.equal(text, '[1] PLAYERS\n[2] seat 1: Ana\n\n[3] QUEST 1\n[4]   1.1.1 Ana: hi');
  assert.equal(lines, 4);
});

test('a fact or attribution is flagged when wrong, unsupported, or tied to no line of the record', () => {
  const statements = [1, 2, 3, 4, 5, 6, 7].map((id) => ({
    id,
    section: 'narrative',
    text: `s${id}`,
  }));
  const checked = readCheck(
    [
      ok(1, 'fact', [3]),
      { id: 2, kind: 'fact', lines: [3], verdict: 'wrong', problem: 'Cy led it, not Ana.' },
      ok(3, 'attribution'),
      ok(4, 'attribution', [99]),
      ok(5, 'opinion'),
      { id: 6, kind: 'claim?', lines: [1], verdict: 'ok' },
      // 7: no answer
    ],
    statements,
    10
  );
  assert.deepEqual(
    checked.map((s) => [s.id, s.flagged, s.problem]),
    [
      [1, false, ''],
      [2, true, 'Cy led it, not Ana.'],
      [3, true, 'the check tied it to no record line'],
      [4, true, 'the check tied it to lines the record does not have (99)'],
      [5, false, ''],
      [6, false, ''],
      [7, false, ''],
    ]
  );
  assert.equal(checked[5]!.kind, null, 'an answer of no known kind leaves it unchecked');
  assert.equal(checked[6]!.verdict, null);
});

test('flagged statements reach the rewrite, and the report keeps the rewrites', async () => {
  const { llm, calls } = stub({
    'check-report.yml': {
      statements: [
        ok(1, 'fact', [6]),
        ok(2, 'fact', [6]),
        ok(3, 'fact', [9]),
        ok(4, 'fact', [10]),
        {
          id: 5,
          kind: 'fact',
          lines: [10],
          verdict: 'unsupported',
          problem: 'Nobody is known to have failed it.',
        },
        { id: 6, kind: 'fact', lines: [6], verdict: 'wrong', problem: 'Ana led quest 1.' },
        { id: 7, kind: 'opinion', lines: [], verdict: 'ok', problem: '' },
        ok(8, 'opinion'),
        {
          id: 9,
          kind: 'attribution',
          lines: [],
          verdict: 'unsupported',
          problem: 'Bo never said it.',
        },
      ],
    },
    'rewrite-report.yml': {
      rewrites: [
        { id: 5, text: '' },
        { id: 6, text: 'رهبر ماموریت اول آنا بود.' },
        { id: 2, text: 'not flagged: ignored' },
        // 9: no rewrite — left as written
      ],
    },
  });

  const { summary, check } = await checkReport(llm, RECORD, SUMMARY);

  assert.deepEqual(
    calls.map((c) => c.file),
    ['check-report.yml', 'rewrite-report.yml']
  );
  const record = calls[0]!.vars.record as string;
  assert.equal(record, numberedRecord(recordText(RECORD)).text);
  assert.match(record, /^\[1\] PLAYERS/);
  assert.match(
    calls[0]!.vars.statements as string,
    /^### narrative\n\[1\] آنا تیم را چید\.\n\[2\] بو در تیم بود؟\n\[3\] سای مخالفت کرد\.\n\[4\] ماموریت شکست خورد!\n\[5\] بو کارت شکست زد\.\n\n### quest 1 commentary\n\[6\] رهبر ماموریت اول سای بود\.\n\[7\] رأی‌ها نزدیک بود\.\n\n### performance note: Ana\n\[8\] آنا خوب بازی کرد\.\n\n### performance note: Bo\n\[9\] بو گفت مرلین است\.$/
  );

  // Only the flagged statements go to the rewrite, with what the check found.
  const flagged = calls[1]!.vars.flagged as string;
  assert.deepEqual(
    [...flagged.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1])),
    [5, 6, 9]
  );
  assert.match(
    flagged,
    /\[6\] \(quest 1 commentary\) رهبر ماموریت اول سای بود\.\n {4}check: Ana led quest 1\. \(record lines 6\)/
  );
  assert.equal(calls[1]!.vars.record, record);
  assert.equal(calls[1]!.vars.statements, calls[0]!.vars.statements);

  // The rewrites in place; everything else as written.
  assert.equal(
    summary.narrative,
    'آنا تیم را چید. بو در تیم بود؟ سای مخالفت کرد.\n\nماموریت شکست خورد!'
  );
  assert.deepEqual(summary.quest_commentary, [
    { quest: 1, commentary: 'رهبر ماموریت اول آنا بود. رأی‌ها نزدیک بود.' },
  ]);
  assert.equal(summary.mode, 'god');
  assert.deepEqual(summary.mode === 'god' && summary.performance, SUMMARY.performance);
  assert.deepEqual(summary.record, SUMMARY.record);

  assert.equal(check.language, 'fa');
  assert.equal(check.statements.length, 9);
  assert.deepEqual(
    check.statements.filter((s) => s.flagged).map((s) => [s.id, s.rewrite]),
    [
      [5, ''],
      [6, 'رهبر ماموریت اول آنا بود.'],
      [9, null],
    ]
  );
  assert.ok(check.statements.filter((s) => !s.flagged).every((s) => !('rewrite' in s)));
});

test('a clean report skips the rewrite and stays as written', async () => {
  const { llm, calls } = stub({
    'check-report.yml': {
      statements: [1, 2, 3, 4, 5, 6, 7]
        .map((id) => ok(id, 'fact', [id]))
        .concat([ok(8, 'opinion'), ok(9, 'attribution', [7])]),
    },
  });
  const { summary, check } = await checkReport(llm, RECORD, SUMMARY);
  assert.deepEqual(
    calls.map((c) => c.file),
    ['check-report.yml']
  );
  assert.deepEqual(summary, SUMMARY);
  assert.ok(check.statements.every((s) => !s.flagged));
});

test('a check with no statements list fails', async () => {
  const { llm } = stub({ 'check-report.yml': { verdicts: [] } });
  await assert.rejects(
    checkReport(llm, RECORD, SUMMARY),
    /check-report\.yml returned no statements list/
  );
});
