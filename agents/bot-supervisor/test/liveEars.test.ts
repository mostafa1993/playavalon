/**
 * The room's live ears (plan 2026-11-15-2100, row A): turns and the
 * discussion, with a fake recognizer in place of Azure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveTurns, type HeardTurn } from '../src/ears/liveTurns.ts';
import { LiveDiscussion } from '../src/ears/liveDiscussion.ts';
import type { RecognizerFactory, SessionEvents } from '../src/ears/recognizer.ts';

/** A recognizer that "hears" a fixed phrase per write, or fails at the end. */
function fakeRecognizers(opts: { fail?: boolean } = {}) {
  const opened: { written: number; events: SessionEvents }[] = [];
  const factory: RecognizerFactory = {
    open(events = {}) {
      const s = { written: 0, events };
      opened.push(s);
      return {
        write() {
          s.written += 1;
          events.onSpeaking?.();
        },
        async end() {
          if (opts.fail) throw new Error('boom');
          if (s.written === 0) return '';
          events.onPhrase?.(`phrase ${s.written}`);
          return `phrase ${s.written}`;
        },
      };
    },
  };
  return { factory, opened };
}

const loud = new Int16Array(160).fill(5000);
const speaker = (identity: string, turnIndex: number) => ({
  identity,
  displayName: identity.toUpperCase(),
  questNumber: 1,
  roundIndex: 0,
  turnIndex,
  startedAt: new Date(),
});
const flush = () => new Promise((r) => setTimeout(r, 10));

function turnsWith(recognizers: RecognizerFactory, clip = async () => 'from the clip') {
  const heard: HeardTurn[] = [];
  const turns = new LiveTurns({
    recognizers,
    isBot: (id) => id.startsWith('bot_'),
    transcribeClip: clip,
    isSilent: (pcm) => pcm.every((x) => x === 0),
    onTurn: (t) => heard.push(t),
    warn: () => {},
  });
  return { turns, heard };
}

test("a person's turn is transcribed live and reported when it ends, with its place in the order", async () => {
  const { factory } = fakeRecognizers();
  const { turns, heard } = turnsWith(factory);
  turns.setActiveSpeaker(speaker('reza', 2));
  turns.onAudioFrame('reza', loud, 16000);
  turns.onAudioFrame('someone-else', loud, 16000);
  turns.onAudioFrame('reza', loud, 16000);
  turns.clearActiveSpeaker();
  await flush();
  assert.equal(heard.length, 1);
  assert.deepEqual(
    { speaker: heard[0].speaker, turnIndex: heard[0].turnIndex, text: heard[0].text, via: heard[0].via },
    { speaker: 'REZA', turnIndex: 2, text: 'phrase 2', via: 'live' }
  );
});

test('a silent turn is reported with no words; a bot turn is not reported at all', async () => {
  const { factory, opened } = fakeRecognizers();
  const { turns, heard } = turnsWith(factory);
  turns.setActiveSpeaker(speaker('reza', 0));
  turns.onAudioFrame('reza', new Int16Array(160), 16000);
  turns.setActiveSpeaker(speaker('bot_alice', 1));
  turns.onAudioFrame('bot_alice', loud, 16000);
  turns.setActiveSpeaker(speaker('nima', 2));
  turns.clearActiveSpeaker();
  await flush();
  assert.deepEqual(heard.map((t) => [t.speaker, t.text, t.via]), [['REZA', '', 'none'], ['NIMA', '', 'none']]);
  assert.equal(opened.length, 2, 'no session for the bot');
});

test('when the live session fails, the turn is transcribed as a clip', async () => {
  const { factory } = fakeRecognizers({ fail: true });
  const { turns, heard } = turnsWith(factory);
  turns.setActiveSpeaker(speaker('reza', 0));
  turns.onAudioFrame('reza', loud, 16000);
  turns.clearActiveSpeaker();
  await flush();
  assert.deepEqual([heard[0].text, heard[0].via], ['from the clip', 'clip']);
});

test('the discussion: phrases go out as said, "talking" while words come, bots ignored', async () => {
  const { factory } = fakeRecognizers();
  const lines: string[] = [];
  const talking: string[] = [];
  const discussion = new LiveDiscussion({
    recognizers: factory,
    isBot: (id) => id.startsWith('bot_'),
    nameOf: (id) => id.toUpperCase(),
    transcribeClip: async () => 'clip',
    isSilent: () => false,
    onLine: (l) => lines.push(`${l.speaker}: ${l.text}`),
    onTalking: (s) => talking.push(s),
    warn: () => {},
  });
  discussion.onAudioFrame('reza', loud, 16000); // before the discussion: ignored
  discussion.start();
  discussion.onAudioFrame('reza', loud, 16000);
  discussion.onAudioFrame('reza', loud, 16000);
  discussion.onAudioFrame('bot_alice', loud, 16000);
  discussion.stop();
  await flush();
  assert.deepEqual(lines, ['REZA: phrase 2']);
  assert.deepEqual(talking, ['REZA'], 'talking at most every 400 ms');
});
