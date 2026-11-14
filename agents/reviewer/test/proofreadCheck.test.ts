/**
 * The proofreading held to the raw transcript: a table name only where a raw
 * word in its place sounds like it, never one name for another, no Latin
 * letters the raw text doesn't have; and the corrector asking once more with
 * what broke, then putting the names back or, for Latin letters, failing.
 * The model is a stub.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient, PromptVars } from '@avalon/shared';
import { checkProofread } from '../src/reviewer/proofreadCheck.js';
import { correctTranscript } from '../src/reviewer/transcriptCorrector.js';
import type { GameMetaSnapshot } from '../src/types.js';

const TABLE = ['Amir Bashir', 'Amir Kabir', 'Ehsan', 'safa', 'Mostafa', 'Fardin', 'ٔNilou', 'Haj Ali', 'Alireza'];

const breaksOf = (raw: string, corrected: string) =>
  checkProofread(raw, corrected, TABLE).breaks.map((b) => [b.heard, b.names, b.latin]);

test('a misheard name put right passes: باشید → بشیر, احسام → احسان, کعبی → کبیر', () => {
  assert.deepEqual(breaksOf('من به باشید رای دادم', 'من به بشیر رأی دادم'), []);
  assert.deepEqual(breaksOf('احسام چی میگی', 'احسان چی می‌گی؟'), []);
  assert.deepEqual(breaksOf('کعبی را میزارم', 'کبیر رو می‌ذارم'), []);
  assert.deepEqual(breaksOf('نیرو برات سفید میشه', 'نیلو برات سفید می‌شه'), []);
});

test('a name split in two by speech-to-text, or only spaced apart, passes', () => {
  assert.deepEqual(breaksOf('من خودم مثلا فرد این شهر دارم', 'من خودم مثلاً فردین رو شهر دارم'), []);
  assert.deepEqual(breaksOf('من امیرکبیر را میزارم', 'من امیر کبیر رو می‌ذارم'), []);
  assert.deepEqual(breaksOf('کبیرو میلاد بوده', 'کبیر و میلاد بوده'), []);
});

test('a surname turned into a table name is refused: رسولی → امیر بشیر', () => {
  const { breaks, reverted } = checkProofread(
    'قطعه صفا و رسولی سرکوب رسولی این را رد بکنیم',
    'قطعاً صفا و امیر بشیر سر کوبیدن امیر بشیر این رو رد بکنیم',
    TABLE
  );
  assert.deepEqual(breaks, [
    { heard: 'رسولی سرکوب رسولی', wrote: 'امیر بشیر سر کوبیدن امیر بشیر', names: ['امیر', 'بشیر'], latin: false },
  ]);
  assert.equal(reverted, 'قطعاً صفا و رسولی سرکوب رسولی این رو رد بکنیم');
});

test('a table name for a word that sounds nothing like it, or where the speaker said none, is refused', () => {
  assert.deepEqual(breaksOf('حرفای همین به دل من نشسته', 'حرفای امیر کبیر به دل من نشسته'), [
    ['همین', ['امیر', 'کبیر'], false],
  ]);
  assert.deepEqual(breaksOf('چون نمیتوانیم بگوییم ایران معاف شهر', 'چون نمی‌تونی بگی نیلو مافیاست، شهره'), [
    ['نمیتوانیم بگوییم ایران معاف شهر', ['نیلو'], false],
  ]);
  assert.deepEqual(breaksOf('من به رای دادم', 'من به صفا رأی دادم'), [['', ['صفا'], false]]);
  assert.deepEqual(breaksOf('امیر سفیده', 'امیر بشیر سفیده'), [['', ['بشیر'], false]]);
});

test('one table name never becomes another; the same name respelled passes', () => {
  assert.deepEqual(breaksOf('من کبیر را میزارم', 'من بشیر رو می‌ذارم'), [['کبیر را', ['بشیر'], false]]);
  assert.deepEqual(breaksOf('علی گفت', 'علیرضا گفت'), [['علی', ['علیرضا'], false]]);
  assert.deepEqual(breaksOf('مصطفا سفیده', 'مصطفی سفیده'), []);
  assert.deepEqual(breaksOf('حاج علی گفت', 'حاجی گفت'), []);
});

test('names the table does not have are not checked', () => {
  assert.deepEqual(breaksOf('گرفتی امور احسان ورزشی گذاشتی', 'گرفتی امیر و احسان و روزبه رو گذاشتی'), []);
});

test('Latin letters break it only where the raw text has none', () => {
  assert.deepEqual(breaksOf('تیم خوبه', 'team خوبه'), [['تیم', [], true]]);
  assert.deepEqual(breaksOf('ok تیم خوبه', 'OK تیم خوبه'), []);
});

const PLAYERS: GameMetaSnapshot['players'] = TABLE.map((display_name, i) => ({
  id: `p${i}`,
  display_name,
  seat_number: i + 1,
}));

function stub(answers: string[]) {
  const asked: PromptVars[] = [];
  const llm: LLMClient = {
    runText: async (_file: string, vars: PromptVars) => {
      asked.push(vars);
      return answers[asked.length - 1]!;
    },
    runJson: async () => {
      throw new Error('no JSON call');
    },
  };
  return { llm, asked };
}

const RAW = 'صفا و رسولی سرکوب رسولی این را رد بکنیم';

test('a correction that keeps to the raw text is asked for once', async () => {
  const { llm, asked } = stub([' صفا و رسولی سرکوب رسولی، این رو رد بکنیم \n']);
  const out = await correctTranscript(llm, RAW, PLAYERS);
  assert.equal(out, 'صفا و رسولی سرکوب رسولی، این رو رد بکنیم');
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.recheck, '');
  assert.match(String(asked[0]!.players), /^- Amir Bashir\n- Amir Kabir\n/);
});

test('a correction that breaks is asked for once more, with what broke', async () => {
  const { llm, asked } = stub([
    'صفا و امیر بشیر سر کوبیدن امیر بشیر این رو رد بکنیم',
    'صفا و رسولی سرکوب رسولی، این رو رد بکنیم',
  ]);
  const out = await correctTranscript(llm, RAW, PLAYERS);
  assert.equal(out, 'صفا و رسولی سرکوب رسولی، این رو رد بکنیم');
  assert.equal(asked.length, 2);
  const recheck = String(asked[1]!.recheck);
  assert.match(recheck, /«امیر بشیر سر کوبیدن امیر بشیر» where the transcript has «رسولی سرکوب رسولی»/);
  assert.match(recheck, /sounds like «امیر», «بشیر»/);
});

test('a second answer with names the speaker did not say keeps its correction, with those places as transcribed', async () => {
  const { llm, asked } = stub([
    'صفا و امیر بشیر سر کوبیدن امیر بشیر این رو رد بکنیم',
    'صفا و امیر بشیر سرکوب رسولی، این رو رد بکنیم',
  ]);
  assert.equal(await correctTranscript(llm, RAW, PLAYERS), 'صفا و رسولی سرکوب رسولی، این رو رد بکنیم');
  assert.equal(asked.length, 2);
});

test('a second answer with Latin letters fails the correction, so the turn keeps its raw transcript', async () => {
  const { llm, asked } = stub([
    'صفا و رسولی team سرکوب رسولی این رو رد بکنیم',
    'Let me check: صفا و رسولی سرکوب رسولی',
  ]);
  await assert.rejects(correctTranscript(llm, RAW, PLAYERS), /wrote Latin letters twice \(«Let me check:»\)/);
  assert.equal(asked.length, 2);
});
