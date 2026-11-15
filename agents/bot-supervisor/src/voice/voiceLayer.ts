/**
 * VoiceLayer — the smart bot's LiveKit presence: its MOUTH, and the timer it
 * keeps time by. It hears no audio: the room's shared ears transcribe what
 * people say once for all the room's smart bots (cli/ears.ts, relayed by the
 * supervisor over IPC).
 *
 * Joins the game's LiveKit room VISIBLY as its player (participant name = the
 * bot's display_name, so the app's seat-mapping gives it a speaking turn like
 * any human), subscribed to nothing, listening to the data channel only.
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
 * bot plays on silent.
 */

import { Room, RoomEvent, type RemoteParticipant } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import {
  DISCUSSION_TIMER_TOPIC,
  TIMER_TOPIC,
  TimerListener,
  TurnSegmenter,
  publishAudioTrack,
  synthesize,
  type AudioPublisher,
  type AzureSpeechConfig,
  type SpeakingTimerState,
} from '@avalon/shared';
import { TalkClock } from './talkClock.js';
import type { AgentLogger } from '../util/logger.js';

const MOUTH_SAMPLE_RATE = 48000; // WebRTC-native; matches synthesize()
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

/** Fired once when the bot is within two speakers of its slot (or queued): time to write. */
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
  /** The assassin-phase discussion timer (the assassin's timing reads it). */
  readonly discussionClock = new TalkClock();
  private onDiscussionStart: (() => void) | null = null;
  private discussionRunning = false;
  private room: Room | null = null;
  private readonly nameByIdentity = new Map<string, string>();
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

  /** Register the engine's handler for the assassin-phase discussion starting. */
  setOnDiscussionStart(handler: () => void): void {
    this.onDiscussionStart = handler;
  }

  /**
   * Join the room and start listening. Returns null (bot plays deaf) when the
   * env is incomplete or the join fails — never throws.
   */
  static async tryCreate(opts: VoiceLayerOptions): Promise<VoiceLayer | null> {
    const env = readVoiceEnv();
    if (!env) {
      opts.logger.warn('[mouth] LiveKit/Azure env incomplete — playing silent');
      return null;
    }
    // LiveKit's native layer can fail a first connect (seen: "handle not found"); try again.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const layer = new VoiceLayer(env, opts);
      try {
        await layer.join();
        opts.logger.info('[mouth] joined LiveKit; keeping time by the speaking timer');
        return layer;
      } catch (err) {
        opts.logger.warn(`[mouth] LiveKit join failed (${(err as Error).message}), attempt ${attempt} of 3`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    opts.logger.warn('[mouth] could not join LiveKit — playing silent');
    return null;
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
      canSubscribe: false, // the room's ears hear for the bot
      canPublishData: true, // the "my turn is done" message
    });

    // The round count comes from the timer; the bot hears no audio, so this
    // segmenter never gets a frame and never emits a turn.
    const timerListener = new TimerListener(new TurnSegmenter(() => {}), {
      displayName: (identity) => this.nameByIdentity.get(identity) ?? identity,
    });

    const room = new Room();
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      if (p.name) this.nameByIdentity.set(p.identity, p.name);
    });
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic === DISCUSSION_TIMER_TOPIC) {
        this.watchDiscussion(payload);
        return;
      }
      if (topic !== TIMER_TOPIC) return;
      timerListener.onPayload(payload);
      this.watchForMyTurn(payload, timerListener);
    });

    await room.connect(this.env.livekitUrl, await token.toJwt(), {
      autoSubscribe: false, // the room's ears hear for the bot
      dynacast: false,
    });
    for (const p of room.remoteParticipants.values()) {
      if (p.name) this.nameByIdentity.set(p.identity, p.name);
    }
    this.room = room;
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

  /** The discussion timer's messages: keep its clock, and say when it starts. */
  private watchDiscussion(payload: Uint8Array): void {
    let running = false;
    try {
      running = (JSON.parse(new TextDecoder().decode(payload)) as { running?: boolean }).running === true;
    } catch {
      return;
    }
    this.discussionClock.onState({ timerRunning: running, currentSpeakerIndex: 0, speakingOrder: [] });
    const started = running && !this.discussionRunning;
    this.discussionRunning = running;
    if (started) {
      this.opts.logger.info('[mouth] the assassin discussion started');
      this.onDiscussionStart?.();
    }
  }

  /** The bot is one of the next two speakers (or queued): fire onPrepare once for that slot. */
  private watchForNext(state: SpeakingTimerState, quest: number, round: number): void {
    if (!this.onPrepare || !state.speakingOrder) return;
    let mine = -1;
    for (let i = state.currentSpeakerIndex; i < state.speakingOrder.length; i += 1) {
      if (state.speakingOrder[i] === this.selfIdentity) {
        mine = i;
        break;
      }
    }
    // Two speakers ahead: a silent player's turn passes in seconds, and a statement takes 20-40 s.
    if (mine < 0 || mine - state.currentSpeakerIndex > 2) return;
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
   * no sentence fits. Returns the words it spoke, or null. `free`: speech
   * outside the speaking timer (the assassin discussion), held to the same length.
   */
  async say(text: string, slotStartedAt: number, opts: { free?: boolean } = {}): Promise<string | null> {
    if (!this.room) return null;
    const mine = () => opts.free === true || this.currentActiveSpeaker === this.selfIdentity;
    let parts = sentences(text);
    while (parts.length > 0) {
      const left = SLOT_SECONDS - SLOT_MARGIN_SECONDS - (Date.now() - slotStartedAt) / 1000;
      const pcm = await synthesize(this.env.azure, parts.join(' '), {
        voice: this.opts.voice,
        sampleRate: MOUTH_SAMPLE_RATE,
      });
      if (!mine()) {
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

  async close(): Promise<void> {
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
