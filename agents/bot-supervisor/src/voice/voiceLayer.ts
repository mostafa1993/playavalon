/**
 * VoiceLayer — the smart bot's LiveKit presence. Phase 3: EARS only.
 *
 * Joins the game's LiveKit room as a hidden subscriber, follows the
 * speaking-timer broadcast (who's talking), buffers the active speaker's
 * audio per turn (shared TurnSegmenter), transcribes completed turns
 * (Azure STT), and appends {speaker, text} to the TalkMemory the LLMBrain
 * reads. Phase 4 turns this same connection into the mouth.
 *
 * Entirely optional: if LiveKit/Azure env is missing or the join fails, the
 * bot plays on without ears (the brain notes the empty transcript).
 */

import {
  AudioStream,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import {
  TIMER_TOPIC,
  TimerListener,
  TurnSegmenter,
  isSilent,
  transcribe,
  type AzureSpeechConfig,
  type RecordedTurn,
} from '@avalon/shared';
import { TalkMemory } from './talkMemory.js';
import type { AgentLogger } from '../util/logger.js';

const EAR_SAMPLE_RATE = 16000; // matches the reviewer's STT rate
const SILENCE_RMS_THRESHOLD = 250;

export interface VoiceLayerOptions {
  roomCode: string;
  botName: string; // config name, e.g. 'alice'
  logger: AgentLogger;
  /** The bot's memory (owned by the engine; the brain reads it even when deaf). */
  memory: TalkMemory;
}

interface VoiceEnv {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  azure: AzureSpeechConfig;
}

function readVoiceEnv(): VoiceEnv | null {
  const {
    LIVEKIT_URL,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION,
  } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
    return null;
  }
  return {
    livekitUrl: LIVEKIT_URL,
    livekitApiKey: LIVEKIT_API_KEY,
    livekitApiSecret: LIVEKIT_API_SECRET,
    azure: {
      key: AZURE_SPEECH_KEY,
      region: AZURE_SPEECH_REGION,
      language: process.env.AZURE_SPEECH_LANGUAGE || 'fa-IR',
    },
  };
}

export class VoiceLayer {
  private readonly memory: TalkMemory;
  private room: Room | null = null;
  private readonly consumers = new Map<string, AbortController>();
  private readonly nameByIdentity = new Map<string, string>();
  private pendingStt: Set<Promise<void>> = new Set();

  private constructor(
    private readonly env: VoiceEnv,
    private readonly opts: VoiceLayerOptions
  ) {
    this.memory = opts.memory;
  }

  /**
   * Join the room and start listening. Returns null (bot plays deaf) when the
   * env is incomplete or the join fails — never throws.
   */
  static async tryCreate(opts: VoiceLayerOptions): Promise<VoiceLayer | null> {
    const env = readVoiceEnv();
    if (!env) {
      opts.logger.warn('[ears] LiveKit/Azure env incomplete — playing without ears');
      return null;
    }
    const layer = new VoiceLayer(env, opts);
    try {
      await layer.join();
      opts.logger.info('[ears] joined LiveKit; listening to the table');
      return layer;
    } catch (err) {
      opts.logger.warn(`[ears] LiveKit join failed (${(err as Error).message}) — playing without ears`);
      return null;
    }
  }

  private async join(): Promise<void> {
    const token = new AccessToken(this.env.livekitApiKey, this.env.livekitApiSecret, {
      identity: `ears-bot_${this.opts.botName}`,
      name: `ears-${this.opts.botName}`,
      ttl: '10h',
    });
    token.addGrant({
      room: this.opts.roomCode,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      hidden: true, // listeners shouldn't appear in the players' UI
    });

    const onTurnFinished = (turn: RecordedTurn) => {
      const task = this.processTurn(turn).catch((err) => {
        this.opts.logger.warn(`[ears] turn STT failed: ${(err as Error).message}`);
      });
      this.pendingStt.add(task);
      void task.finally(() => this.pendingStt.delete(task));
    };
    const segmenter = new TurnSegmenter(onTurnFinished);
    const timerListener = new TimerListener(segmenter, {
      displayName: (identity) => this.nameByIdentity.get(identity) ?? identity,
    });

    const room = new Room();
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      if (p.name) this.nameByIdentity.set(p.identity, p.name);
    });
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (participant.name) this.nameByIdentity.set(participant.identity, participant.name);
        if (track instanceof RemoteAudioTrack) this.consumeAudio(track, participant.identity, segmenter);
      }
    );
    room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        this.consumers.get(participant.identity)?.abort();
        this.consumers.delete(participant.identity);
      }
    );
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic === TIMER_TOPIC) timerListener.onPayload(payload);
    });

    await room.connect(this.env.livekitUrl, await token.toJwt(), {
      autoSubscribe: true,
      dynacast: false,
    });
    // Seed names for participants already in the room.
    for (const p of room.remoteParticipants.values()) {
      if (p.name) this.nameByIdentity.set(p.identity, p.name);
      for (const pub of p.trackPublications.values()) {
        if (pub.track instanceof RemoteAudioTrack) this.consumeAudio(pub.track, p.identity, segmenter);
      }
    }
    this.room = room;
  }

  private consumeAudio(track: RemoteAudioTrack, identity: string, segmenter: TurnSegmenter): void {
    if (this.consumers.has(identity)) return;
    const controller = new AbortController();
    this.consumers.set(identity, controller);

    const stream = new AudioStream(track, { sampleRate: EAR_SAMPLE_RATE, numChannels: 1 });
    const reader = stream.getReader();
    controller.signal.addEventListener('abort', () => {
      reader.cancel().catch(() => {});
    });

    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          segmenter.onAudioFrame(identity, frame.data, frame.sampleRate);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          this.opts.logger.debug(`[ears] audio stream ended for ${identity}`, {
            error: (err as Error).message,
          });
        }
      }
    })();
  }

  private async processTurn(turn: RecordedTurn): Promise<void> {
    if (isSilent(turn.pcm, SILENCE_RMS_THRESHOLD)) return;
    const result = await transcribe(this.env.azure, turn.pcm, turn.sampleRate);
    if (!result.transcript.trim()) return;
    this.memory.addTurn(turn.questNumber, turn.roundIndex, turn.speakerDisplayName, result.transcript);
    this.opts.logger.debug(
      `[ears] heard ${turn.speakerDisplayName} (Q${turn.questNumber}/R${turn.roundIndex}, ${turn.durationSec.toFixed(0)}s)`
    );
  }

  async close(): Promise<void> {
    for (const c of this.consumers.values()) c.abort();
    this.consumers.clear();
    await Promise.allSettled(Array.from(this.pendingStt));
    if (this.room) {
      await this.room.disconnect().catch(() => {});
      this.room = null;
    }
  }
}
