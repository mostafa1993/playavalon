/**
 * An evil bot in the assassin discussion (voice/discussionTalk.ts, plan
 * 2026-11-15-2100 row D). Fakes for the model, the voice and the supervisor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient } from '@avalon/shared';
import { DiscussionTalk, MAX_BOT_RUN, botRun, someoneTalking, worthDeciding } from '../src/voice/discussionTalk.ts';
import { TalkMemory, type DiscussionLine } from '../src/voice/talkMemory.ts';
import type { FromBot } from '../src/supervisor/roomRelay.ts';
import type { VoiceLayer } from '../src/voice/voiceLayer.ts';
import type { SmartView } from '../src/brains/smartView.ts';
import type { Observation } from '../src/types/Observation.ts';
import type { Identity } from '../src/types/Identity.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const line = (speaker: string, fromBot = false): DiscussionLine => ({ speaker, text: '...', fromBot });

test('a line calls for a decision unless it is mine, or one bot line too many in a row', () => {
  assert.equal(worthDeciding([], 'Alice'), false);
  assert.equal(worthDeciding([line('Reza')], 'Alice'), true);
  assert.equal(worthDeciding([line('Alice', true)], 'Alice'), false);
  const below = Array.from({ length: MAX_BOT_RUN - 1 }, (_, i) => line(`Bot${i}`, true));
  assert.equal(worthDeciding([line('Reza'), ...below], 'Alice'), true);
  assert.equal(worthDeciding([line('Reza'), ...below, line('Bob', true)], 'Alice'), false, 'not after MAX_BOT_RUN bot lines in a row');
  assert.equal(botRun([line('Bob', true), line('Reza'), line('Bob', true), line('Carl', true)]), 2);
});

test('someone is talking if heard within the last second', () => {
  const now = 10_000;
  assert.equal(someoneTalking(new Map([['Reza', now - 300]]), now), true);
  assert.equal(someoneTalking(new Map([['Reza', now - 3_000]]), now), false);
});

const until = async (ok: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await sleep(5);
};

function world(replies: string[], replyMs = 10, speakMs = 0) {
  const talk = new TalkMemory();
  const said: string[] = [];
  const told: FromBot[] = [];
  let decisions = 0;
  const llm = {
    async runJson() {
      const reply = replies[Math.min(decisions, replies.length - 1)];
      decisions += 1;
      await sleep(replyMs);
      return { reply };
    },
  } as unknown as LLMClient;
  const voice = {
    async say(text: string) {
      said.push(text);
      await sleep(speakMs);
      return text;
    },
  } as unknown as VoiceLayer;
  const smart = { talk, brief: () => 'brief', gameSoFar: async () => 'game', privateRead: () => 'read' } as unknown as SmartView;
  const me = { user_id: 'alice', display_name: 'Alice', role: 'evil' } as unknown as Identity;
  let bot: DiscussionTalk;
  const tell = (m: FromBot) => {
    told.push(m);
    // The supervisor grants the floor at once.
    if (m.type === 'floor-request') setTimeout(() => bot.onFloor(), 1);
  };
  bot = new DiscussionTalk({
    voice,
    talk,
    llm,
    smart,
    identity: () => me,
    fetch: async () => ({ room: { players: [] }, game: null }) as unknown as Observation,
    tell,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  return { bot, talk, said, told, decisions: () => decisions };
}

test('the bot opens, then answers a person, taking and giving back the floor each time', async () => {
  const w = world(['به نظرم رضا مرلینه.', 'آره، چون تیم دوم رو اون چید.']);
  w.bot.start();
  await until(() => w.told.some((m) => m.type === 'floor-release'));
  w.talk.addDiscussion('Reza', 'تو چرا فکر می‌کنی من مرلینم؟', false);
  w.bot.onLine();
  await until(() => w.said.length === 2 && w.told.filter((m) => m.type === 'floor-release').length === 2);
  assert.deepEqual(w.said, ['به نظرم رضا مرلینه.', 'آره، چون تیم دوم رو اون چید.']);
  assert.deepEqual(
    w.told.map((m) => m.type),
    ['floor-request', 'discussed', 'floor-release', 'floor-request', 'discussed', 'floor-release']
  );
  assert.equal(w.talk.discussion().at(-1)?.fromBot, true);
});

test('a reply overtaken by newer talk is dropped and thought again on the newest line', async () => {
  const w = world(['جواب اول', 'جواب دوم'], 30);
  w.bot.start();
  await sleep(10);
  w.talk.addDiscussion('Reza', 'یه حرف تازه', false); // while the opening is being written
  w.bot.onLine();
  await sleep(120);
  assert.deepEqual(w.said, ['جواب دوم']);
  assert.equal(w.decisions(), 2);
});

test('a good bot stays out of the discussion', async () => {
  const w = world(['x']);
  (w.bot as unknown as { d: { identity: () => Identity } }).d.identity = () => ({ user_id: 'a', display_name: 'A', role: 'good' }) as unknown as Identity;
  w.bot.start();
  await sleep(30);
  assert.deepEqual(w.said, []);
});

test('a person who answers while the bot is speaking is answered next', async () => {
  const w = world(['به نظرم رضا مرلینه.', 'چون تو تیم دوم بود.'], 5, 40);
  w.bot.start();
  await until(() => w.said.length === 1);
  // Reza answers while Alice is still speaking.
  w.talk.addDiscussion('Reza', 'چرا من؟', false);
  w.bot.onLine();
  await until(() => w.said.length === 2);
  assert.deepEqual(w.said, ['به نظرم رضا مرلینه.', 'چون تو تیم دوم بود.']);
  assert.deepEqual(w.talk.discussion().map((l) => l.speaker), ['Alice', 'Reza', 'Alice'], 'my line before the answer to it');
});

test('a line heard while a decision failed is still answered', async () => {
  const w = world(['جواب']);
  let calls = 0;
  (w.bot as unknown as { d: { llm: LLMClient } }).d.llm = {
    async runJson() {
      calls += 1;
      await sleep(10);
      if (calls === 1) throw new Error('timeout');
      return { reply: 'جواب' };
    },
  } as unknown as LLMClient;
  w.bot.start();
  await sleep(2);
  w.talk.addDiscussion('Reza', 'سلام؟', false);
  w.bot.onLine();
  await until(() => w.said.length === 1);
  assert.deepEqual(w.said, ['جواب']);
});

test('the bot waits until the person has finished before deciding, and decides once', async () => {
  const w = world(['جواب']);
  (w.bot as unknown as { active: boolean }).active = true;
  w.bot.onTalking('Reza');
  w.talk.addDiscussion('Reza', 'تکه‌ی اول،', false);
  w.bot.onLine();
  // Reza keeps talking for a while, then finishes his sentence.
  const talk = setInterval(() => w.bot.onTalking('Reza'), 300);
  await sleep(600);
  w.talk.addDiscussion('Reza', 'تکه‌ی دوم.', false);
  w.bot.onLine();
  clearInterval(talk);
  await until(() => w.said.length === 1, 4_000);
  assert.equal(w.decisions(), 1, 'one decision, on the whole line');
});

test('a slow decision gets a second call alongside; the first answer counts', async () => {
  const w = world(['x']);
  let calls = 0;
  (w.bot as unknown as { d: { llm: LLMClient } }).d.llm = {
    async runJson() {
      calls += 1;
      if (calls === 1) await sleep(60_000); // hangs
      return { reply: 'جواب دوم' };
    },
  } as unknown as LLMClient;
  (w.bot as unknown as { active: boolean }).active = true;
  w.talk.addDiscussion('Reza', 'سلام؟', false);
  const started = Date.now();
  w.bot.onLine();
  await until(() => w.said.length === 1, 7_000);
  assert.deepEqual(w.said, ['جواب دوم']);
  assert.ok(Date.now() - started < 6_500, 'answered by the second call');
});
