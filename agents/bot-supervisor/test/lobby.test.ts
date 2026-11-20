/**
 * The lobby (plan 2026-11-20 lobby talk): the ears' live lobby transcriber, a
 * bot's name in what people said, and LobbyTalk. Fakes for Azure, the model,
 * the voice and the supervisor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LLMClient } from '@avalon/shared';
import { LiveLobby } from '../src/ears/liveLobby.ts';
import type { RecognizerFactory, SessionEvents } from '../src/ears/recognizer.ts';
import { mentions } from '../src/voice/names.ts';
import { LobbyTalk, callerWords } from '../src/voice/lobbyTalk.ts';
import { loadAgentConfig } from '../src/config/loader.ts';
import { TalkMemory } from '../src/voice/talkMemory.ts';
import type { FromBot } from '../src/supervisor/roomRelay.ts';
import type { VoiceLayer } from '../src/voice/voiceLayer.ts';
import type { Observation } from '../src/types/Observation.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await sleep(5);
};
const loud = new Int16Array(160).fill(3000);
const quiet = new Int16Array(160);

test("the bots' real names: found when called, never inside everyday words", () => {
  const cfg = (n: string) => {
    const c = loadAgentConfig(`configs/${n}.yaml`);
    return [n[0]!.toUpperCase() + n.slice(1), ...c.call_names];
  };
  const parisa = cfg('parisa'), koorosh = cfg('koorosh'), dariush = cfg('dariush'), mandana = cfg('mandana');
  assert.equal(mentions('داریوش جان، تو چی فکر می‌کنی؟', dariush), true);
  assert.equal(mentions('ماندانا، خوبی؟', mandana), true);
  assert.equal(mentions('کوروشو صدا کن', koorosh), true, 'with the object ending');
  assert.equal(mentions('پلیسا تو اهل کجایی', parisa), true, 'heard so once');
  const everyday = ['داریم منتظر می‌مونیم', 'دارین میاین؟', 'داریش؟', 'برداریش', 'نگه‌داریش', 'دادیش بهش', 'کاریش نداشته باش',
    'ماندند تا آخر', 'ماندنی شد', 'موندنا', 'دکورش قشنگه', 'کروشه بذار', 'بچه‌ها بریم بازی', 'پیتزا سفارش بدیم'];
  for (const line of everyday) {
    for (const [who, names] of Object.entries({ parisa, koorosh, dariush, mandana })) {
      assert.equal(mentions(line, names), false, `${who} must not hear "${line}" as a call`);
    }
  }
});

test('a name is found in the spellings recognition gives', () => {
  const names = ['Koorosh', 'کوروش', 'کورش', 'کروش'];
  assert.equal(mentions('سلام كوروش جان، خوبی؟', names), true, 'Arabic kaf');
  assert.equal(mentions('کروش تو اهل کجایی', names), true);
  assert.equal(mentions('KOOROSH what do you think', names), true);
  assert.equal(mentions('پری‌سا بیا', ['پریسا']), true, 'a joiner inside the name');
  assert.equal(mentions('سلام بچه‌ها', names), false);
  assert.equal(mentions('پلیسا تو اهل کجایی', ['پریسا']), true, 'one letter off (heard so once)');
  assert.equal(mentions('پریا تو اهل کجایی', ['پریسا']), false, 'پریا is another name');
  assert.equal(mentions('پیتزا میخوای', ['پریسا']), false);
  assert.equal(mentions('من اینجا بودم', ['پریسا', 'کوروش', 'داریوش', 'ماندانا']), false);
});

function fakeRecognizers() {
  const sessions: { written: number; ended: boolean; events: SessionEvents }[] = [];
  const factory: RecognizerFactory = {
    open(events = {}) {
      const s = { written: 0, ended: false, events };
      sessions.push(s);
      return {
        write() {
          s.written += 1;
        },
        async end() {
          s.ended = true;
          events.onPhrase?.(`phrase of ${s.written} frames`);
          return '';
        },
      };
    },
  };
  return { factory, sessions };
}

test('the lobby: a session opens on speech (with the moment before), closes after a pause, and the phrase goes out', async () => {
  const { factory, sessions } = fakeRecognizers();
  const lines: string[] = [];
  const talking: string[] = [];
  const lobby = new LiveLobby({
    recognizers: factory,
    isBot: (id) => id.startsWith('bot_'),
    nameOf: (id) => id.toUpperCase(),
    onLine: (l) => lines.push(`${l.speaker}: ${l.text}`),
    onTalking: (s) => talking.push(s),
    talkingRms: 500,
    warn: () => {},
    pauseMs: 60,
  });
  for (let i = 0; i < 5; i += 1) lobby.onAudioFrame('reza', quiet, 16000);
  assert.equal(sessions.length, 0, 'silence opens nothing');
  lobby.onAudioFrame('reza', loud, 16000);
  lobby.onAudioFrame('reza', loud, 16000);
  lobby.onAudioFrame('bot_parisa', loud, 16000);
  assert.equal(sessions.length, 1, 'one session, none for the bot');
  assert.ok(sessions[0]!.written >= 3, 'the moment before speech went in too');
  assert.deepEqual(talking, ['REZA']);
  await sleep(350); // the pause, then the clock's sweep closes it
  assert.equal(sessions[0]!.ended, true);
  assert.equal(lines.length, 1);
  lobby.stop();
  lobby.onAudioFrame('reza', loud, 16000);
  assert.equal(sessions.length, 1, 'nothing after the game has begun');
});

function world(answers: string[], opts: { writeMs?: number; timing?: Record<string, number> } = {}) {
  const talk = new TalkMemory();
  const said: string[] = [];
  const told: FromBot[] = [];
  const requests: string[] = [];
  let bot: LobbyTalk;
  const llm = {
    async runJson(_f: string, vars: { request: string }) {
      requests.push(vars.request);
      await sleep(opts.writeMs ?? 5);
      return { reply: answers[Math.min(requests.length - 1, answers.length - 1)] };
    },
  } as unknown as LLMClient;
  const voice = {
    async say(text: string) {
      said.push(text);
      return text;
    },
  } as unknown as VoiceLayer;
  const room = {
    room: { players: [{ id: 'p', display_name: 'Parisa', is_bot: true }, { id: 'r', display_name: 'Reza' }], role_config: { merlin: true }, expected_players: 5 },
    game: null,
  } as unknown as Observation;
  bot = new LobbyTalk({
    voice,
    talk,
    llm,
    fetch: async () => room,
    myId: 'p',
    tell: (m) => {
      told.push(m);
      if (m.type === 'floor-request') setTimeout(() => bot.onFloor(), 1);
    },
    logger: { info: (m: string) => process.env.LOBBY_DEBUG && console.log(Date.now() % 100000, m), warn: (m: string) => process.env.LOBBY_DEBUG && console.log(Date.now() % 100000, m), error: () => {}, debug: () => {} },
    persona: 'Parisa loves poetry.',
    callNames: ['پریسا'],
    timing: { quietMs: 40, doneMs: 60, settleMaxMs: 400, hedgeMs: 2_000, floorWaitMs: 500, quietWaitMs: 300, ...opts.timing },
  });
  bot.start('Parisa');
  const hear = (speaker: string, text: string, fromBot = false) => {
    talk.addLobby(speaker, text, fromBot);
    bot.onLine();
  };
  return { bot, talk, said, told, requests, hear };
}

test('called by name, the bot answers once, then is quiet until called again', async () => {
  const w = world(['سلام رضا!', 'من عاشق حافظم.']);
  w.hear('Reza', 'سلام بچه‌ها');
  await sleep(30);
  assert.deepEqual(w.said, [], 'no name, no answer');
  w.hear('Reza', 'پریسا، خوبی؟');
  await until(() => w.said.length === 1);
  w.hear('Reza', 'چه هوای خوبیه');
  await sleep(30);
  assert.equal(w.said.length, 1);
  w.hear('Reza', 'پریسا شاعر مورد علاقه‌ت کیه؟');
  await until(() => w.said.length === 2);
  assert.deepEqual(w.said, ['سلام رضا!', 'من عاشق حافظم.']);
  assert.deepEqual(w.told.filter((m) => m.type === 'lobby-said').length, 2);
  assert.deepEqual(w.talk.lobby().map((l) => l.speaker).slice(-2), ['Reza', 'Parisa']);
});

test("the caller's request is all they said from the call on, once they have finished", async () => {
  const w = world(['جواب']);
  w.bot.onTalking('Reza');
  w.hear('Reza', 'پریسا،');
  const talking = setInterval(() => w.bot.onTalking('Reza'), 20);
  await sleep(60);
  w.hear('Mina', 'من هم هستم');
  w.hear('Reza', 'تو اهل کجایی؟');
  clearInterval(talking);
  await until(() => w.said.length === 1);
  assert.deepEqual(w.requests, ['پریسا، تو اهل کجایی؟']);
});

test("another bot's line with my name is not a call; nothing once the game has begun", async () => {
  const w = world(['x']);
  w.hear('Koorosh', 'پریسا نظرت چیه؟', true);
  await sleep(30);
  assert.deepEqual(w.said, []);
  w.bot.stop();
  w.hear('Reza', 'پریسا؟');
  await sleep(30);
  assert.deepEqual(w.said, []);
});

test('callerWords keeps the caller\'s lines only', () => {
  const lines = [
    { speaker: 'Reza', text: 'قبلش', fromBot: false },
    { speaker: 'Reza', text: 'پریسا،', fromBot: false },
    { speaker: 'Mina', text: 'سلام', fromBot: false },
    { speaker: 'Reza', text: 'چطوری؟', fromBot: false },
  ];
  assert.equal(callerWords(lines, { index: 1, speaker: 'Reza' }), 'پریسا، چطوری؟');
});

test('a second caller while the first is still talking is answered next', async () => {
  const w = world(['جواب رضا', 'جواب مینا']);
  w.bot.onTalking('Reza');
  w.hear('Reza', 'پریسا، خوبی؟');
  w.hear('Mina', 'پریسا تو اهل کجایی؟');
  await until(() => w.said.length === 2);
  assert.deepEqual(w.requests, ['پریسا، خوبی؟', 'پریسا تو اهل کجایی؟']);
  assert.deepEqual(w.said, ['جواب رضا', 'جواب مینا']);
});

test('the game begins while the bot waits for quiet: it says nothing', async () => {
  // "Talking" every 10 ms against a 200 ms quiet window: late timers can't fake a quiet moment.
  const w = world(['جواب'], { timing: { quietMs: 200, doneMs: 200 } });
  // Someone keeps talking, so the bot waits for quiet; then the game begins.
  w.bot.onTalking('Mina');
  const talking = setInterval(() => w.bot.onTalking('Mina'), 10);
  w.hear('Reza', 'پریسا، خوبی؟');
  await until(() => w.told.some((m) => m.type === 'floor-request'));
  await sleep(50);
  w.bot.stop();
  clearInterval(talking);
  await sleep(400);
  assert.deepEqual(w.said, []);
  assert.ok(w.told.some((m) => m.type === 'floor-release'), 'the floor given back');
});

test("a lobby that won't go quiet: the answer goes rather than over people", async () => {
  const w = world(['جواب'], { timing: { quietMs: 200, doneMs: 200 } });
  w.bot.onTalking('Mina');
  const talking = setInterval(() => w.bot.onTalking('Mina'), 10);
  w.hear('Reza', 'پریسا، خوبی؟');
  await until(() => w.told.some((m) => m.type === 'floor-release'), 3_000);
  clearInterval(talking);
  assert.deepEqual(w.said, []);
  assert.ok(w.told.some((m) => m.type === 'floor-request'), 'it did try');
});

test('a caller who keeps adding: the answer is written again at most twice', async () => {
  const w = world(['جواب'], { writeMs: 40, timing: { settleMaxMs: 0 } });
  w.hear('Reza', 'پریسا،');
  const more = setInterval(() => w.hear('Reza', 'و یه چیز دیگه'), 25);
  await until(() => w.said.length === 1, 3_000);
  clearInterval(more);
  assert.equal(w.said.length, 1);
  assert.ok(w.requests.length <= 3 + 1, `${w.requests.length} writes`);
});

test('the lobby listener: a pause in the frames closes a session, the next speech opens another, the pre-roll is short', async () => {
  const { factory, sessions } = fakeRecognizers();
  const lobby = new LiveLobby({
    recognizers: factory,
    isBot: () => false,
    nameOf: (id) => id,
    onLine: () => {},
    onTalking: () => {},
    talkingRms: 500,
    warn: () => {},
    pauseMs: 30,
  });
  for (let i = 0; i < 100; i += 1) lobby.onAudioFrame('reza', quiet, 16000); // 1 s of quiet before speech
  lobby.onAudioFrame('reza', loud, 16000);
  assert.ok(sessions[0]!.written <= 41 + 1, `pre-roll ~400 ms, wrote ${sessions[0]!.written} frames`);
  await sleep(40);
  lobby.onAudioFrame('reza', quiet, 16000); // a quiet frame after the pause closes it
  assert.equal(sessions[0]!.ended, true);
  lobby.onAudioFrame('reza', loud, 16000);
  assert.equal(sessions.length, 2, 'speaking again opens a new session');
  lobby.stop();
});
