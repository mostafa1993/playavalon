#!/usr/bin/env node
/**
 * A room's ears: one hidden listener per room with smart bots (plan row G),
 * started and stopped by the supervisor, which relays what it hears to each
 * smart bot of the room (supervisor/roomRelay.ts).
 *
 * It hears every timed speaking turn (the speaking timer says whose it is) and
 * the assassin-phase discussion, transcribes each person's speech once with
 * Azure, and sends it to the supervisor over IPC. The bots' own turns are
 * skipped: each bot sends the exact words it said.
 *
 * Usage (by the supervisor): tsx src/cli/ears.ts --room <CODE>
 */

import {
  DiscussionListener,
  DiscussionRecorder,
  LiveKitListener,
  TimerListener,
  TurnSegmenter,
  isSilent,
  transcribe,
  type AzureSpeechConfig,
  type RecordedDiscussion,
  type RecordedTurn,
} from '@avalon/shared';
import type { Heard } from '../supervisor/roomRelay.js';
import { makeLogger } from '../util/logger.js';

const SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 250;

const args = process.argv.slice(2);
const room = args[args.indexOf('--room') + 1];
const log = makeLogger(`ears:${room}`);

/** People speak; bots join as bot_<name> and send their own words. */
const isBot = (identity: string) => identity.startsWith('bot_');

function send(message: Heard): void {
  if (process.send) process.send(message);
  else log.info(`heard (no supervisor to send to): ${JSON.stringify(message)}`);
}

async function main(): Promise<void> {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION } = process.env;
  if (!room || !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
    log.error('missing --room or the LiveKit/Azure env; the room has no ears');
    process.exit(1);
  }
  const azure: AzureSpeechConfig = {
    key: AZURE_SPEECH_KEY,
    region: AZURE_SPEECH_REGION,
    language: process.env.AZURE_SPEECH_LANGUAGE || 'fa-IR',
  };

  const pending = new Set<Promise<void>>();
  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  const onTurn = (turn: RecordedTurn) => {
    if (isBot(turn.speakerIdentity)) return;
    track(
      (async () => {
        if (isSilent(turn.pcm, turn.sampleRate, SILENCE_RMS_THRESHOLD)) return;
        const { transcript } = await transcribe(azure, turn.pcm, turn.sampleRate);
        if (!transcript.trim()) return;
        send({ type: 'turn', quest: turn.questNumber, round: turn.roundIndex, speaker: turn.speakerDisplayName, text: transcript.trim() });
        log.info(`heard ${turn.speakerDisplayName} (Q${turn.questNumber}/R${turn.roundIndex}, ${turn.durationSec.toFixed(0)} s)`);
      })().catch((err) => log.warn(`turn transcription failed: ${(err as Error).message}`))
    );
  };

  const onDiscussion = (recording: RecordedDiscussion) => {
    for (const segment of recording.speakers) {
      if (isBot(segment.identity)) continue;
      track(
        (async () => {
          if (isSilent(segment.pcm, segment.sampleRate, SILENCE_RMS_THRESHOLD)) return;
          const { transcript } = await transcribe(azure, segment.pcm, segment.sampleRate);
          if (!transcript.trim()) return;
          send({ type: 'discussion', speaker: segment.displayName, text: transcript.trim() });
          log.info(`heard ${segment.displayName} in the assassin discussion (${segment.durationSec.toFixed(0)} s)`);
        })().catch((err) => log.warn(`discussion transcription failed: ${(err as Error).message}`))
      );
    }
  };

  const segmenter = new TurnSegmenter(onTurn);
  const recorder = new DiscussionRecorder(onDiscussion);
  let nameOf: (identity: string) => string = (identity) => identity;
  const timerListener = new TimerListener(segmenter, { displayName: (identity) => nameOf(identity) });
  const discussionListener = new DiscussionListener(recorder, (identity) => nameOf(identity));

  const listener = new LiveKitListener(
    {
      wsUrl: LIVEKIT_URL,
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      roomName: room,
      identity: `room-ears-${room}`,
      displayName: 'Room ears',
      sampleRate: SAMPLE_RATE,
      channels: 1,
    },
    {
      onAudioFrame: (identity, data, sampleRate) => {
        segmenter.onAudioFrame(identity, data, sampleRate);
        recorder.onAudioFrame(identity, data, sampleRate);
      },
      onTimerData: (payload) => timerListener.onPayload(payload),
      onDiscussionTimerData: (payload) => discussionListener.onPayload(payload),
    }
  );
  nameOf = (identity) => listener.displayNameFor(identity) || identity;

  await listener.join();
  log.info('listening to the room');

  const stop = async (sig: string) => {
    log.info(`got ${sig}; finishing what is being transcribed`);
    await Promise.allSettled(Array.from(pending));
    await listener.leave().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}

main().catch((err) => {
  log.error('ears fatal', err);
  process.exit(1);
});
