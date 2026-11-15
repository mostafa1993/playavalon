/**
 * A smart bot's speaking turn (voice/turnSpeaker.ts, plan 2026-11-15-2100 rows
 * C and G): catch up on the speaker before, then the draft, the draft brought
 * up to date, words written now, or a pass line. Fakes for the model and the
 * voice; nothing is called.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient } from '@avalon/shared';
import { TurnSpeaker, PASS_LINE } from '../src/voice/turnSpeaker.ts';
import { TalkMemory } from '../src/voice/talkMemory.ts';
import type { FromBot } from '../src/supervisor/roomRelay.ts';
import type { VoiceLayer } from '../src/voice/voiceLayer.ts';
import type { SmartView } from '../src/brains/smartView.ts';
import type { Observation } from '../src/types/Observation.ts';
import type { Identity } from '../src/types/Identity.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

interface World {
  speaker: TurnSpeaker;
  talk: TalkMemory;
  said: string[];
  told: FromBot[];
  handedOn: string[];
  calls: string[];
  team: string[] | null;
}

/**
 * A bot (Alice) at a table with Reza; `llm` answers drafts with `draft`, and
 * streams `update` / `fresh` sentence by sentence (null: the call fails;
 * 'hang': never answers).
 */
function world(opts: {
  draft?: string | null;
  draftMs?: number;
  update?: string[] | null | 'hang';
  fresh?: string[] | null | 'hang';
  ran?: boolean;
}): World {
  const talk = new TalkMemory();
  const w: World = { speaker: null as unknown as TurnSpeaker, talk, said: [], told: [], handedOn: [], calls: [], team: null };
  const stream = (answer: string[] | null | 'hang' | undefined, signal?: AbortSignal) =>
    (async function* () {
      if (answer === 'hang') {
        await new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped'))));
      }
      await sleep(5);
      if (!answer) throw new Error('failed');
      for (const s of answer) yield s + ' ';
    })();
  const llm = {
    async runText(file: string) {
      w.calls.push(file);
      await sleep(opts.draftMs ?? 0);
      if (opts.draft === null) throw new Error('draft failed');
      return opts.draft ?? 'پیش‌نویس.';
    },
    runJson: async () => ({}),
    streamText(file: string, _vars: unknown, override: { model?: string; thinking_level?: string } | undefined, signal?: AbortSignal) {
      w.calls.push(`${file}${override?.thinking_level ? ` ${override.thinking_level}` : ''}`);
      return stream(file === 'speak-update.yml' ? opts.update : opts.fresh, signal);
    },
  } as unknown as LLMClient;
  const voice = {
    async say(text: string) {
      w.said.push(text);
      return text;
    },
    async speak(source: AsyncIterable<string>) {
      const parts: string[] = [];
      for await (const s of source) parts.push(s);
      const text = parts.join(' ');
      w.said.push(text);
      return text;
    },
    turnRan: () => opts.ran ?? true,
    async handOn(key: string) {
      w.handedOn.push(key);
    },
  } as unknown as VoiceLayer;
  const smart = { talk, brief: () => 'brief', gameSoFar: async () => 'game', privateRead: () => 'read' } as unknown as SmartView;
  const identity = { user_id: 'alice', display_name: 'Alice', role: 'good' } as unknown as Identity;
  const observation = () =>
    ({
      room: { players: [] },
      game: {
        current_quest: 1,
        vote_track: 0,
        current_leader_id: 'reza',
        players: [
          { id: 'reza', display_name: 'Reza', seat_position: 0 },
          { id: 'alice', display_name: 'Alice', seat_position: 1 },
        ],
        current_proposal: w.team ? { team_member_ids: w.team } : null,
      },
    }) as unknown as Observation;
  w.speaker = new TurnSpeaker({
    voice,
    talk,
    llm,
    smart,
    identity: () => identity,
    fetch: async () => observation(),
    tell: (m) => w.told.push(m),
    logger: silentLog,
    timing: { catchUpMs: 300, hedgeAfterMs: 40, updateByMs: 150, minUpdateMs: 80, passAtMs: 250 },
  });
  return w;
}

const turn = { quest: 1, round: 0, turnIndex: 1, speakers: 3 };

test('nothing new since the draft: the draft is said as it is', async () => {
  const w = world({ draft: 'من به این تیم رای میدم.' });
  w.speaker.prepare(turn);
  await sleep(20);
  w.talk.addTurn(1, 0, 0, 'Reza', ''); // the speaker before said nothing
  await w.speaker.myTurn(turn);
  assert.deepEqual(w.said, ['من به این تیم رای میدم.']);
  assert.deepEqual(w.calls, ['speak-turn.yml']);
  assert.deepEqual(w.told, [{ type: 'said', quest: 1, round: 0, turnIndex: 1, speaker: 'Alice', text: 'من به این تیم رای میدم.' }]);
  assert.deepEqual(w.handedOn, ['1:0:1']);
});

test("the speaker before is waited for, and the draft brought up to date with their words", async () => {
  const w = world({ update: ['رضا راست میگه.', 'رای منفی میدم.'] });
  w.speaker.prepare(turn);
  await sleep(20);
  setTimeout(() => w.talk.addTurn(1, 0, 0, 'Reza', 'من به آلیس شک دارم'), 60);
  const started = Date.now();
  await w.speaker.myTurn(turn);
  assert.ok(Date.now() - started >= 55, 'waited for Reza');
  assert.deepEqual(w.said, ['رضا راست میگه. رای منفی میدم.']);
  assert.deepEqual(w.calls, ['speak-turn.yml', 'speak-update.yml']);
});

test('a team proposed since the draft is news too', async () => {
  const w = world({ update: ['حالا که تیم معلومه، رای مثبت.'] });
  w.speaker.prepare(turn);
  await sleep(20);
  w.team = ['reza', 'alice'];
  w.talk.addTurn(1, 0, 0, 'Reza', '');
  await w.speaker.myTurn(turn);
  assert.deepEqual(w.calls, ['speak-turn.yml', 'speak-update.yml']);
});

test('an update that hangs is hedged; when neither comes in time, the draft is said', async () => {
  const w = world({ draft: 'پیش‌نویس.', update: 'hang' });
  w.speaker.prepare(turn);
  await sleep(20);
  w.talk.addTurn(1, 0, 0, 'Reza', 'یه حرف تازه');
  await w.speaker.myTurn(turn);
  assert.deepEqual(w.said, ['پیش‌نویس.']);
  assert.deepEqual(w.calls, ['speak-turn.yml', 'speak-update.yml', 'speak-update.yml']);
});

test('no draft: the words are written now, on Hydrogen LOW', async () => {
  const w = world({ fresh: ['سلام.', 'من رد می‌کنم.'], ran: false });
  await w.speaker.myTurn(turn);
  assert.deepEqual(w.said, ['سلام. من رد می‌کنم.']);
  assert.deepEqual(w.calls, ['speak-turn.yml LOW']);
});

test('a skipped turn before me is not waited for', async () => {
  const w = world({ fresh: ['سلام.'], ran: false });
  const started = Date.now();
  await w.speaker.myTurn(turn);
  assert.ok(Date.now() - started < 200);
});

test('nothing written in time and no draft: a pass line, never silence', async () => {
  const w = world({ draft: null, fresh: 'hang', ran: false });
  w.speaker.prepare(turn);
  await w.speaker.myTurn(turn);
  assert.deepEqual(w.said, [PASS_LINE]);
  assert.equal((w.told[0] as { text: string }).text, PASS_LINE);
});

test('the speaker before me done before my slot opens: my words are composed then, ready when it opens', async () => {
  const w = world({ update: ['رضا، قبول دارم.'] });
  w.speaker.prepare(turn);
  await sleep(20);
  w.talk.addTurn(1, 0, 0, 'Reza', 'من به این تیم اعتماد دارم');
  w.speaker.heardTurn(1, 0, 0);
  await sleep(40); // the host opens my slot a little later
  const opened = Date.now();
  await w.speaker.myTurn(turn);
  assert.ok(Date.now() - opened < 30, 'no wait at the slot');
  assert.deepEqual(w.said, ['رضا، قبول دارم.']);
  assert.deepEqual(w.calls, ['speak-turn.yml', 'speak-update.yml']);
});

test('a turn heard that is not just before one of my slots starts nothing', async () => {
  const w = world({ update: ['x'] });
  w.speaker.prepare(turn);
  w.speaker.heardTurn(1, 0, 3);
  w.speaker.heardTurn(2, 0, 0);
  await sleep(30);
  assert.deepEqual(w.calls, ['speak-turn.yml']);
});

test('a draft still being written races the words written now, and wins if it comes first', async () => {
  const w = world({ draft: 'پیش‌نویس کامل.', draftMs: 20, fresh: 'hang', ran: false });
  w.speaker.prepare(turn);
  await w.speaker.myTurn(turn);
  assert.deepEqual(w.said, ['پیش‌نویس کامل.']);
  assert.deepEqual(w.calls, ['speak-turn.yml', 'speak-turn.yml LOW']);
});
