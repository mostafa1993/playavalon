/**
 * VoiceLayer — the smart bot's LiveKit presence: EARS + MOUTH.
 *
 * Joins the game's LiveKit room VISIBLY as its player (participant name =
 * the bot's display_name, so the app's seat-mapping gives it a speaking
 * turn like any human).
 *
 * Ears: follows the speaking-timer broadcast, buffers the active speaker's
 * audio per turn (shared TurnSegmenter), transcribes completed turns
 * (Azure STT) into the TalkMemory the LLMBrain reads.
 *
 * Mouth: when the bot is next in the speaking order it fires onPrepare, so the
 * engine writes its statement while the speaker before it talks; when the
 * timer reaches its own slot it fires onMyTurn (once per turn), and the engine
 * calls say() — Azure TTS → publishAudioTrack — then handOn(), which tells the
 * host's browser the turn is done. say() fits the words to the time left in
 * the slot (whole sentences dropped from the end), and stays quiet if the
 * slot has passed.
 *
 * Entirely optional: if LiveKit/Azure env is missing or the join fails, the
 * bot plays on silent + deaf (the brain notes the empty transcript).
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
  publishAudioTrack,
  synthesize,
  transcribe,
  type AudioPublisher,
  type AzureSpeechConfig,
  type RecordedTurn,
  type SpeakingTimerState,
} from '@avalon/shared';
import { TalkMemory } from './talkMemory.js';
import { TalkClock } from './talkClock.js';
import type { AgentLogger } from '../util/logger.js';

const EAR_SAMPLE_RATE = 16000; // matches the reviewer's STT rate
const MOUTH_SAMPLE_RATE = 48000; // WebRTC-native; matches synthesize()
const SILENCE_RMS_THRESHOLD = 250;
/** A bot's speaking turn, as the host's timer gives it (src/lib/domain/speaking-turn.ts). */
export const SLOT_SECONDS = 30;
/** Stop this long before the slot's end. */
const SLOT_MARGIN_SECONDS = 1.5;
/** The bot's "my turn is done" message to the host (src/lib/domain/speaking-turn.ts). */
const SPEAKER_DONE_TOPIC = 'speaker-done';

/** Where the bot's slot sits: the quest (0 = the intro round), the round of
 *  talk, its place in the speaking order and that order's length. */
export interface MyTurnInfo {
  quest: number;
  round: number;
  turnIndex: number;
  speakers: number;
}

/** Fired once when the speaking timer reaches the bot's own slot. */
export type MyTurnHandler = (info: MyTurnInfo) => void;

/** Fired once when the bot becomes the next speaker (or is queued to speak): time to write. */
export type PrepareHandler = (info: MyTurnInfo) => void;

/** The turn a MyTurnInfo is about, the same for its prepare and its slot. */
export function turnKey(info: Pick<MyTurnInfo, 'quest' | 'round' | 'turnIndex'>): string {
  return `${info.quest}:${info.round}:${info.turnIndex}`;
}

/** Sentences of a Persian statement, end punctuation kept. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?؟…]+[.!?؟…]*/g) ?? [text]).map((x) => x.trim()).filter(Boolean);
}

export interface VoiceLayerOptions {
  roomCode: string;
  botName: string; // config name, e.g. 'alice'
  /** The bot's in-game display name — MUST match its player row, so the app's
   *  seat-mapping (participant.name === display_name) includes it. */
  displayName: string;
  /** Azure neural voice for say(), e.g. fa-IR-DilaraNeural. */
  voice: string;
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
  /** The speaking timer as heard on the data channel (vote timing reads it). */
  readonly clock = new TalkClock();
  private readonly memory: TalkMemory;
  private room: Room | null = null;
  private readonly consumers = new Map<string, AbortController>();
  private readonly nameByIdentity = new Map<string, string>();
  private pendingStt: Set<Promise<void>> = new Set();
  // Mouth state
  private readonly selfIdentity: string;
  private publisher: AudioPublisher | null = null;
  private currentActiveSpeaker: string | null = null;
  private lastFiredTurnKey: string | null = null;
  private lastPreparedKey: string | null = null;
  private onMyTurn: MyTurnHandler | null = null;
  private onPrepare: PrepareHandler | null = null;

  private constructor(
    private readonly env: VoiceEnv,
    private readonly opts: VoiceLayerOptions
  ) {
    this.memory = opts.memory;
    this.selfIdentity = `bot_${opts.botName}`;
  }

  /** Register the engine's my-turn handler (fired once per speaking slot). */
  setOnMyTurn(handler: MyTurnHandler): void {
    this.onMyTurn = handler;
  }

  /** Register the engine's prepare handler (fired once per upcoming slot). */
  setOnPrepare(handler: PrepareHandler): void {
    this.onPrepare = handler;
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
      // Visible player presence: the app maps participants to seats by
      // name === display_name, which also puts the bot in the speaking order.
      identity: this.selfIdentity,
      name: this.opts.displayName,
      ttl: '10h',
    });
    token.addGrant({
      room: this.opts.roomCode,
      roomJoin: true,
      canPublish: true, // the mouth
      canSubscribe: true,
      canPublishData: true, // the "my turn is done" message
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
      if (topic !== TIMER_TOPIC) return;
      timerListener.onPayload(payload);
      this.watchForMyTurn(payload, timerListener);
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

  /** Detect "the timer just reached MY slot" and fire onMyTurn once per turn. */
  private watchForMyTurn(payload: Uint8Array, timerListener: TimerListener): void {
    let state: SpeakingTimerState;
    try {
      state = JSON.parse(new TextDecoder().decode(payload)) as SpeakingTimerState;
    } catch {
      return;
    }
    const active =
      state.timerRunning && state.speakingOrder
        ? (state.speakingOrder[state.currentSpeakerIndex] ?? null)
        : null;
    this.currentActiveSpeaker = active;
    this.clock.onState(state);
    const quest = state.isIntro ? 0 : state.questNumber;
    const round = timerListener.getCurrentRoundIndex();
    this.watchForNext(state, quest, round);
    if (active !== this.selfIdentity || !this.onMyTurn) return;

    const key = `${quest}:${round}:${state.currentSpeakerIndex}`;
    if (key === this.lastFiredTurnKey) return; // repeated broadcasts of the same slot
    this.lastFiredTurnKey = key;
    this.opts.logger.info(`[mouth] my speaking slot started (Q${quest}/R${round})`);
    this.onMyTurn({ quest, round, turnIndex: state.currentSpeakerIndex, speakers: state.speakingOrder.length });
  }

  /** The bot is next (or queued and not started): fire onPrepare once for that slot. */
  private watchForNext(state: SpeakingTimerState, quest: number, round: number): void {
    if (!this.onPrepare || !state.speakingOrder) return;
    let mine = -1;
    for (let i = state.currentSpeakerIndex; i < state.speakingOrder.length; i += 1) {
      if (state.speakingOrder[i] === this.selfIdentity) {
        mine = i;
        break;
      }
    }
    if (mine < 0 || mine - state.currentSpeakerIndex > 1) return;
    const info = { quest, round, turnIndex: mine, speakers: state.speakingOrder.length };
    const key = turnKey(info);
    if (key === this.lastPreparedKey) return;
    this.lastPreparedKey = key;
    this.opts.logger.info(`[mouth] next to speak (Q${quest}/R${round}) — preparing`);
    this.onPrepare(info);
  }

  /**
   * Speak a Persian statement into the room: TTS → publish, fitted to the time
   * left in the slot that started at `slotStartedAt`: whole sentences are
   * dropped from the end until it fits. Stays quiet if the slot has passed or
   * no sentence fits. Returns the words it spoke, or null.
   */
  async say(text: string, slotStartedAt: number): Promise<string | null> {
    if (!this.room) return null;
    let parts = sentences(text);
    while (parts.length > 0) {
      const left = SLOT_SECONDS - SLOT_MARGIN_SECONDS - (Date.now() - slotStartedAt) / 1000;
      const pcm = await synthesize(this.env.azure, parts.join(' '), {
        voice: this.opts.voice,
        sampleRate: MOUTH_SAMPLE_RATE,
      });
      if (this.currentActiveSpeaker !== this.selfIdentity) {
        this.opts.logger.warn('[mouth] slot passed before synthesis finished — staying quiet');
        return null;
      }
      const seconds = pcm.length / MOUTH_SAMPLE_RATE;
      if (seconds > left) {
        this.opts.logger.info(`[mouth] ${seconds.toFixed(0)} s of speech for ${Math.max(0, left).toFixed(0)} s left — dropping a sentence`);
        parts = parts.slice(0, -1);
        continue;
      }
      if (!this.publisher) {
        this.publisher = await publishAudioTrack(this.room, { sampleRate: MOUTH_SAMPLE_RATE });
      }
      this.opts.logger.info(`[mouth] speaking (${seconds.toFixed(0)} s, ${Math.round((Date.now() - slotStartedAt) / 1000)} s into the slot)`);
      await this.publisher.speak(pcm);
      return parts.join(' ');
    }
    this.opts.logger.warn('[mouth] no sentence fits the time left — staying quiet');
    return null;
  }

  /** Tell the host's browser this bot's turn is done (it moves to the next speaker). */
  async handOn(): Promise<void> {
    if (!this.room || this.currentActiveSpeaker !== this.selfIdentity) return;
    await this.room.localParticipant
      ?.publishData(new TextEncoder().encode(JSON.stringify({ at: Date.now() })), { reliable: true, topic: SPEAKER_DONE_TOPIC })
      .catch((err: Error) => this.opts.logger.warn(`[mouth] hand-on failed: ${err.message}`));
  }

  private async processTurn(turn: RecordedTurn): Promise<void> {
    if (isSilent(turn.pcm, turn.sampleRate, SILENCE_RMS_THRESHOLD)) return;
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
    if (this.publisher) {
      await this.publisher.close().catch(() => {});
      this.publisher = null;
    }
    if (this.room) {
      await this.room.disconnect().catch(() => {});
      this.room = null;
    }
  }
}
