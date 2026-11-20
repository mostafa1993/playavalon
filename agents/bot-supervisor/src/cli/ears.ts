#!/usr/bin/env node
/**
 * A room's ears: one hidden listener per room with smart bots, started and
 * stopped by the supervisor, which relays what it hears to each smart bot of
 * the room (supervisor/roomRelay.ts).
 *
 * It hears every timed speaking turn (the speaking timer says whose it is) and
 * the assassin-phase discussion — and before the game, the lobby's chat — and
 * transcribes people's speech live with
 * Azure (plan 2026-11-15-2100, D1): a turn's words go out about a second after
 * it ends, a discussion phrase as soon as it is said. The bots' own speech is
 * skipped: each bot sends the exact words it said.
 *
 * Usage (by the supervisor): tsx src/cli/ears.ts --room <CODE>
 */

import {
  DiscussionListener,
  LiveKitListener,
  TimerListener,
  isSilent,
  transcribe,
  type AzureSpeechConfig,
  tolerateLiveKitHandleErrors,
} from '@avalon/shared';
import type { Heard } from '../supervisor/roomRelay.js';
import { azureRecognizers } from '../ears/recognizer.js';
import { LiveTurns } from '../ears/liveTurns.js';
import { LiveDiscussion } from '../ears/liveDiscussion.js';
import { LiveLobby } from '../ears/liveLobby.js';
import { makeLogger } from '../util/logger.js';

const SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 250;
/** A frame (10 ms at 16 kHz) this loud is someone talking, for "don't talk over them". */
const TALKING_RMS = 500;

const args = process.argv.slice(2);
const room = args[args.indexOf('--room') + 1];
const log = makeLogger(`ears:${room}`);
// LiveKit's native layer can throw while dropping its own handles; the ears keep listening.
tolerateLiveKitHandleErrors(log);

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

  const silent = (pcm: Int16Array, rate: number) => isSilent(pcm, rate, SILENCE_RMS_THRESHOLD);
  const transcribeClip = async (pcm: Int16Array, rate: number) => (await transcribe(azure, pcm, rate)).transcript;
  const recognizers = azureRecognizers({ ...azure, sampleRate: SAMPLE_RATE });
  let nameOf: (identity: string) => string = (identity) => identity;

  const turns = new LiveTurns({
    recognizers,
    isBot,
    transcribeClip,
    isSilent: silent,
    onTurn: (turn) => {
      send({ type: 'turn', quest: turn.quest, round: turn.round, turnIndex: turn.turnIndex, speaker: turn.speaker, text: turn.text });
      log.info(
        `heard ${turn.speaker} (Q${turn.quest}/R${turn.round}/T${turn.turnIndex}, ${turn.durationSec.toFixed(0)} s): ` +
          `${turn.text ? `${turn.text.length} chars, ${turn.via}` : 'nothing'}, ${turn.latencyMs} ms after the turn`
      );
    },
    warn: (m) => log.warn(m),
  });
  const discussion = new LiveDiscussion({
    recognizers,
    isBot,
    nameOf: (identity) => nameOf(identity),
    transcribeClip,
    isSilent: silent,
    onLine: (line) => {
      send({ type: 'discussion', speaker: line.speaker, text: line.text, fromBot: false });
      log.info(`heard ${line.speaker} in the assassin discussion (${line.text.length} chars, ${line.via})`);
    },
    onTalking: (speaker) => send({ type: 'talking', speaker }),
    talkingRms: TALKING_RMS,
    warn: (m) => log.warn(m),
  });

  // Before the game: the lobby's chat, for the bots to answer when called by name.
  const lobby = new LiveLobby({
    recognizers,
    isBot,
    nameOf: (identity) => nameOf(identity),
    onLine: (line) => {
      send({ type: 'lobby', speaker: line.speaker, text: line.text, fromBot: false });
      log.info(`heard ${line.speaker} in the lobby (${line.text.length} chars)`);
    },
    onTalking: (speaker) => send({ type: 'talking', speaker }),
    talkingRms: TALKING_RMS,
    warn: (m) => log.warn(m),
  });
  // Restarted (perhaps mid-game): the lobby is not ours to hear.
  if (args.includes('--no-lobby')) lobby.stop();
  const endLobby = (why: string) => {
    if (!lobby.isActive()) return;
    lobby.stop();
    log.info(`${why}: no longer listening to the lobby`);
  };

  const timerListener = new TimerListener(turns, { displayName: (identity) => nameOf(identity) });
  const discussionListener = new DiscussionListener(discussion, (identity) => nameOf(identity));

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
        lobby.onAudioFrame(identity, data, sampleRate);
        turns.onAudioFrame(identity, data, sampleRate);
        discussion.onAudioFrame(identity, data, sampleRate);
      },
      onTimerData: (payload) => {
        endLobby('the game has begun');
        timerListener.onPayload(payload);
      },
      onDiscussionTimerData: (payload) => {
        endLobby('the assassin discussion');
        discussionListener.onPayload(payload);
      },
    }
  );
  nameOf = (identity) => listener.displayNameFor(identity) || identity;

  // LiveKit's native layer can fail a first connect (seen: "handle not found"); try again.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await listener.join();
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      log.warn(`joining the room failed (${(err as Error).message}); attempt ${attempt + 1} of 3 in 2 s`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log.info('listening to the room');

  const stop = async (sig: string) => {
    log.info(`got ${sig}; finishing what is being transcribed`);
    timerListener.finalize();
    discussionListener.finalize();
    lobby.stop();
    await Promise.allSettled([...turns.pending(), ...discussion.pending(), ...lobby.pending()]);
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
