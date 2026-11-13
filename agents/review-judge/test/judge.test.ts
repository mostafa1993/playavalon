import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';
import { loadPrompt } from '@avalon/shared';
import { computeMeasures, sameName, teamOfGuess, type SentenceVerdict } from '../src/measures.js';
import { matchVerdicts } from '../src/judge.js';
import { readRecord, recordText, type JudgeRecord } from '../src/record.js';
import { readReport, reportSentences } from '../src/report.js';

const record: JudgeRecord = {
  gameId: 'g1',
  mode: 'god',
  players: [
    { id: 'a', display_name: 'Ana', seat_number: 1, role: 'good', special_role: 'merlin' },
    { id: 'b', display_name: 'ٔBo', seat_number: 2, role: 'evil', special_role: 'assassin' },
    { id: 'c', display_name: 'Cy', seat_number: 3, role: 'good', special_role: 'servant' },
    { id: 'd', display_name: 'Di', seat_number: 4, role: 'evil', special_role: 'minion' },
  ],
  proposals: [
    {
      quest: 1,
      proposalNumber: 1,
      leaderId: 'a',
      teamIds: ['a', 'c'],
      status: 'approved',
      votes: [
        { playerId: 'a', vote: 'approve' },
        { playerId: 'b', vote: 'reject' },
      ],
    },
  ],
  missions: [{ quest: 1, teamIds: ['a', 'c'], successCount: 2, failCount: 0, result: 'success' }],
  lady: [{ quest: 2, investigatorId: 'c', targetId: 'b', result: 'evil' }],
  assassinPickId: 'c',
  outcome: { winner: 'good', win_reason: '3_quest_successes' },
  turns: [
    { quest: 0, round: 0, turn: 2, speakerId: 'd', transcript: 'معرفی', confidence: 0.8, proposalNumber: null },
    { quest: 1, round: 0, turn: 0, speakerId: 'a', transcript: 'سلام', confidence: 0.9, proposalNumber: 1 },
  ],
  discussion: null,
};

test('teamOfGuess reads English and Persian labels, evil words first', () => {
  assert.equal(teamOfGuess('Loyal Servant'), 'good');
  assert.equal(teamOfGuess('Merlin'), 'good');
  assert.equal(teamOfGuess('Minion of Mordred'), 'evil');
  assert.equal(teamOfGuess('Assassin'), 'evil');
  assert.equal(teamOfGuess('مرلین'), 'good');
  assert.equal(teamOfGuess('مورگانا'), 'evil');
  assert.equal(teamOfGuess('unsure'), null);
});

test('sameName ignores case, spacing and combining marks', () => {
  assert.ok(sameName('ٔRana', 'rana'));
  assert.ok(sameName(' Kian  Sadr ', 'kian sadr'));
  assert.ok(!sameName('Ana', 'Anna'));
});

test('readRecord refuses a blind record', () => {
  assert.throws(() => readRecord({ ...record, mode: 'blind' }), /god-mode/);
  assert.equal(readRecord(record).gameId, 'g1');
});

test('recordText names leaders, votes, Lady results and the pick, and counts talk from 1', () => {
  const text = recordText(record);
  assert.match(text, /Q1\.1: leader Ana; team Ana, Cy; approve: Ana; reject: ٔBo; approved/);
  assert.match(text, /after Q2: Cy looked at ٔBo → evil/);
  assert.match(text, /ASSASSIN'S PICK: Cy/);
  assert.match(text, /^intro\.3 Di \(intro, conf 0\.80\): معرفی$/m);
  assert.match(text, /^1\.1\.1 Ana \(proposal 1\.1, conf 0\.90\): سلام$/m);
});

const godSummary = {
  language: 'fa',
  narrative: 'آنا رهبر بود. تیم رد شد؟ بله.\nپایان',
  role_reveal: 'نقش‌ها',
  performance: [{ player: 'Ana', role: 'merlin', assessment: 'خوب بازی کرد.' }],
  quests: [
    {
      quest_number: 1,
      leader_display_name: 'Ana',
      proposals: [{ proposal_number: 1, team: ['Ana', 'Cy'], approvals: ['Ana'], rejections: ['Bo'], status: 'approved' }],
      mission: { team: ['Ana', 'Cy'], success_count: 2, fail_count: 0, result: 'success' },
      narrative_summary: 'خلاصه اول. خلاصه دوم.',
      turning_points: [],
      mvp: null,
      suspicious_players: [{ player: 'Bo', reason: 'دلیل' }],
    },
  ],
  discussion: null,
};

test('readReport splits each quest into its facts and its commentary', () => {
  const r = readReport(godSummary);
  assert.equal(r.mode, 'god');
  assert.deepEqual(
    r.sections.map((s) => `${s.section}/${s.kind}`),
    ['role reveal/prose', 'narrative/prose', 'performance: Ana/prose', 'quest 1 facts/quest-facts', 'quest 1/prose']
  );
});

test('reportSentences numbers every sentence once: prose at sentence ends, quest facts per line', () => {
  const sentences = reportSentences(readReport(godSummary));
  assert.deepEqual(sentences.map((s) => s.id), sentences.map((_, i) => i + 1));
  const narrative = sentences.filter((s) => s.section === 'narrative').map((s) => s.text);
  assert.deepEqual(narrative, ['آنا رهبر بود.', 'تیم رد شد؟', 'بله.', 'پایان']);
  const facts = sentences.filter((s) => s.kind === 'quest-facts').map((s) => s.text);
  assert.equal(facts.length, 3);
  assert.match(facts[0] ?? '', /^Leader: Ana$/);
  assert.match(facts[1] ?? '', /^Proposal 1: team Ana, Cy; approved by Ana; rejected by Bo; approved$/);
});

test('readReport keeps a blind report\'s guesses for measure 3, out of the checked text', () => {
  const r = readReport({
    mode: 'blind',
    final_summary: 'خلاصه',
    final_guesses: [
      { player: 'Ana', guessed_role: 'Merlin', confidence: 'high', reasoning: 'x' },
      { player: 'Bo', guessed_role: 'Loyal Servant', confidence: 'low', reasoning: 'y' },
    ],
    quests: [],
    discussion: null,
  });
  assert.equal(r.mode, 'blind');
  assert.ok(r.sections.every((s) => !/Merlin|Loyal Servant|^x$|^y$/.test(s.text)));
  assert.deepEqual(r.finalGuesses, [
    { player: 'Ana', guessedRole: 'Merlin' },
    { player: 'Bo', guessedRole: 'Loyal Servant' },
  ]);
});

/** A format-2 summary: the record's facts, which the page renders, and the model's text. */
const currentGod = {
  format: 2,
  mode: 'god',
  language: 'fa',
  narrative: 'آنا رهبر اول بود. بو تیم را برد.',
  quest_commentary: [
    { quest: 1, commentary: 'تفسیر اول.' },
    { quest: 9, commentary: 'not a quest' },
  ],
  performance: [{ playerId: 'b', assessment: 'زیرکانه بازی کرد.' }],
  record: {
    ...record,
    proposals: [
      ...record.proposals,
      { quest: 1, proposalNumber: 0, leaderId: 'd', teamIds: ['d', 'a'], status: 'rejected', votes: [{ playerId: 'a', vote: 'reject' }] },
      { quest: 2, proposalNumber: 1, leaderId: 'c', teamIds: ['c', 'd'], status: 'pending', votes: [] },
    ],
    lady: [{ quest: 1, investigatorId: 'c', targetId: 'b', result: 'evil' }],
    discussion: { speakers: [{ speakerId: 'b', transcript: 'آنا مرلین است', confidence: 0.6 }] },
  },
};

test('readReport reads a format-2 report: the rendered facts per quest, roles apart, and the model\'s text', () => {
  const r = readReport(currentGod);
  assert.equal(r.mode, 'god');
  assert.deepEqual(
    r.sections.map((s) => `${s.section}/${s.kind}`),
    ['roles/roles', 'narrative/prose', 'performance: ٔBo/prose', 'quest 1 facts/quest-facts', 'quest 1/prose', 'quest 2 facts/quest-facts']
  );
  const facts = r.sections.find((s) => s.section === 'quest 1 facts')!.text.split('\n');
  assert.deepEqual(facts, [
    'Proposal 1.0: leader Di; team Di, Ana; approved by nobody; rejected by Ana; rejected',
    'Proposal 1.1: leader Ana; team Ana, Cy; approved by Ana; rejected by ٔBo; approved',
    'Mission: team Ana, Cy; 2 success, 0 fail; success',
    'Lady of the Lake: Cy looked at ٔBo and saw evil',
  ]);
  assert.equal(r.sections.find((s) => s.section === 'quest 2 facts')!.text, 'Proposal 2.1: leader Cy; team Cy, Di; not voted');
  // The assassin phase's transcripts are the record's own words: not judged.
  assert.ok(r.sections.every((s) => !s.text.includes('آنا مرلین است')));

  const sentences = reportSentences(r);
  assert.deepEqual(
    sentences.filter((s) => s.kind === 'roles').map((s) => s.text),
    ['Seat 1: Ana — merlin (good)', 'Seat 2: ٔBo — assassin (evil)', 'Seat 3: Cy — servant (good)', 'Seat 4: Di — minion (evil)']
  );
  assert.deepEqual(
    sentences.filter((s) => s.section === 'narrative').map((s) => s.text),
    ['آنا رهبر اول بود.', 'بو تیم را برد.']
  );
});

test('readReport reads a format-2 blind report: no roles, no Lady result, the guesses kept for measure 3', () => {
  const r = readReport({
    ...currentGod,
    mode: 'blind',
    performance: undefined,
    final_guesses: [{ player: 'Ana', guessed_role: 'Merlin', confidence: 'high', reasoning: 'x' }],
    guess_timeline: [],
    record: {
      ...currentGod.record,
      mode: 'blind',
      players: record.players.map(({ id, display_name, seat_number }) => ({ id, display_name, seat_number })),
      lady: [{ quest: 1, investigatorId: 'c', targetId: 'b' }],
    },
  });
  assert.deepEqual(
    r.sections.map((s) => `${s.section}/${s.kind}`),
    ['narrative/prose', 'quest 1 facts/quest-facts', 'quest 1/prose', 'quest 2 facts/quest-facts']
  );
  assert.match(r.sections[1]!.text, /\nLady of the Lake: Cy looked at ٔBo$/);
  assert.deepEqual(r.finalGuesses, [{ player: 'Ana', guessedRole: 'Merlin' }]);
});

test('matchVerdicts needs one valid verdict per sentence', () => {
  const sentences = reportSentences(readReport(godSummary));
  const all = sentences.map((s) => ({ id: s.id, evidence: 'e', kind: 'none', verdict: 'none' }));
  assert.equal(matchVerdicts(sentences, all).length, sentences.length);
  assert.throws(() => matchVerdicts(sentences, all.slice(1)), /no valid verdict for sentence\(s\) 1$/);
  const wrongPair = [{ ...all[0], kind: 'fact', verdict: 'correct' }, ...all.slice(1)];
  assert.throws(() => matchVerdicts(sentences, wrongPair), /sentence\(s\) 1$/);
});

const v = (
  id: number,
  sectionKind: 'prose' | 'quest-facts',
  kind: SentenceVerdict['kind'],
  verdict: SentenceVerdict['verdict']
): SentenceVerdict => ({ id, section: 's', sectionKind, text: 't', evidence: 'e', kind, verdict });

test('computeMeasures gives shares overall, in prose and in quest facts, and the blind scores', () => {
  const report = readReport({
    mode: 'blind',
    final_summary: 's',
    final_guesses: [
      { player: 'Ana', guessed_role: 'Merlin' },
      { player: 'ٔbo', guessed_role: 'Assassin' },
      { player: 'Cy', guessed_role: 'Minion' },
      { player: 'Zed', guessed_role: 'Minion' },
    ],
    quests: [],
  });
  const m = computeMeasures(record, report, {
    sentences: [
      v(1, 'prose', 'fact', 'supported'),
      v(2, 'prose', 'fact', 'contradicted'),
      v(3, 'quest-facts', 'fact', 'contradicted'),
      v(4, 'quest-facts', 'fact', 'supported'),
      v(5, 'prose', 'fact', 'not_in_record'),
      v(6, 'prose', 'attribution', 'correct'),
      v(7, 'prose', 'attribution', 'not_found'),
      v(8, 'prose', 'none', 'none'),
    ],
    translation: [],
  });
  assert.equal(m.sentences, 8);
  assert.deepEqual(m.contradicted, { count: 2, of: 5, share: 0.4 });
  assert.deepEqual(m.contradictedInProse, { count: 1, of: 3, share: 1 / 3 });
  assert.deepEqual(m.contradictedInQuestFacts, { count: 1, of: 2, share: 0.5 });
  assert.equal(m.notInRecord, 1);
  assert.deepEqual(m.misattributed, { count: 1, of: 2, share: 0.5 });
  // Ana good ✓, Bo evil ✓, Cy guessed evil ✗, Di unguessed ✗ → 2 of 4.
  assert.equal(m.teamAccuracy, 0.5);
  assert.equal(m.merlinNamed, true);
  assert.deepEqual(m.unmatchedGuesses, ['Zed']);
  assert.deepEqual(m.unguessedPlayers, ['Di']);
  assert.equal(m.translationDifferences, 0);
});

test('computeMeasures leaves blind scores and translation empty when they do not apply', () => {
  const m = computeMeasures(record, readReport({ narrative: 'n', quests: [] }), {
    sentences: [],
    translation: null,
  });
  assert.equal(m.contradicted.share, null);
  assert.equal(m.teamAccuracy, null);
  assert.equal(m.merlinNamed, null);
  assert.equal(m.translationDifferences, null);
});

const promptsDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'prompts');

test('the judge prompts parse, return JSON, and use exactly the variables judge.ts passes', async () => {
  for (const [file, vars] of [
    ['judge-sentences.yml', ['language', 'record', 'sentences']],
    ['judge-translation.yml', ['english_report', 'persian_report']],
  ] as const) {
    const p = await loadPrompt(promptsDir, file);
    assert.equal(p.response_mime_type, 'application/json', file);
    const found = new Set([...`${p.system}\n${p.user}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
    assert.deepEqual([...found].sort(), [...vars], file);
  }
});

test('computeMeasures counts rendered roles in the overall share only', () => {
  const m = computeMeasures(record, readReport(currentGod), {
    sentences: [
      { ...v(1, 'prose', 'fact', 'supported') },
      { ...v(2, 'quest-facts', 'fact', 'supported') },
      { ...v(3, 'prose', 'fact', 'supported'), sectionKind: 'roles', verdict: 'contradicted' },
    ],
    translation: null,
  });
  assert.deepEqual(m.contradicted, { count: 1, of: 3, share: 1 / 3 });
  assert.deepEqual(m.contradictedInProse, { count: 0, of: 1, share: 0 });
  assert.deepEqual(m.contradictedInQuestFacts, { count: 0, of: 1, share: 0 });
});
