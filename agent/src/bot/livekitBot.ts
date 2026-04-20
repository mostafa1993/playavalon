/**
 * Headless LiveKit participant that records every other participant's
 * microphone track. Feeds frames to the turn segmenter via the callback.
 *
 * The bot never publishes audio/video. It subscribes to audio tracks only.
 */

import {
  Room,
  RoomEvent,
  AudioStream,
  RemoteAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { TIMER_TOPIC } from './timerListener.js';
import { DISCUSSION_TIMER_TOPIC } from './discussionListener.js';

export interface BotOptions {
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  identity: string;
  displayName: string;
  sampleRate: number;
  channels: number;
}

export interface BotEvents {
  onAudioFrame: (identity: string, data: Int16Array, sampleRate: number) => void;
  onTimerData: (payload: Uint8Array) => void;
  onDiscussionTimerData: (payload: Uint8Array) => void;
}

export class LiveKitBot {
  private readonly opts: BotOptions;
  private readonly events: BotEvents;
  private room: Room | null = null;
  private readonly identityToName = new Map<string, string>();
  private readonly audioConsumers = new Map<string, AbortController>();

  constructor(opts: BotOptions, events: BotEvents) {
    this.opts = opts;
    this.events = events;
  }

  async join(): Promise<void> {
    const token = await this.mintToken();
    const room = new Room();

    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      this.registerParticipant(p.identity, p.name ?? '');
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        this.registerParticipant(participant.identity, participant.name ?? '');
        if (track instanceof RemoteAudioTrack) {
          this.consumeAudio(track, participant.identity);
        }
      }
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const ctrl = this.audioConsumers.get(participant.identity);
        if (ctrl) {
          ctrl.abort();
          this.audioConsumers.delete(participant.identity);
        }
      }
    );

    room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        if (topic === TIMER_TOPIC) this.events.onTimerData(payload);
        else if (topic === DISCUSSION_TIMER_TOPIC) this.events.onDiscussionTimerData(payload);
      }
    );

    await room.connect(this.opts.wsUrl, token, {
      autoSubscribe: true,
      dynacast: false,
    });
    this.room = room;

    // Pre-populate identity map with participants already in the room.
    for (const p of room.remoteParticipants.values()) {
      this.registerParticipant(p.identity, p.name ?? '');
      for (const pub of p.trackPublications.values()) {
        if (pub.track instanceof RemoteAudioTrack) {
          this.consumeAudio(pub.track, p.identity);
        }
      }
    }
  }

  async leave(): Promise<void> {
    for (const ctrl of this.audioConsumers.values()) ctrl.abort();
    this.audioConsumers.clear();
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
  }

  private registerParticipant(identity: string, displayName: string): void {
    this.identityToName.set(identity, displayName);
  }

  displayNameFor(identity: string): string {
    return this.identityToName.get(identity) ?? identity;
  }

  private consumeAudio(track: RemoteAudioTrack, identity: string): void {
    // If already consuming, skip.
    if (this.audioConsumers.has(identity)) return;

    const controller = new AbortController();
    this.audioConsumers.set(identity, controller);

    const stream = new AudioStream(track, {
      sampleRate: this.opts.sampleRate,
      numChannels: this.opts.channels,
    });
    const reader = stream.getReader();

    // Abort → cancel the reader so the pending read() rejects immediately
    // (otherwise we'd block until the next frame before noticing).
    controller.signal.addEventListener('abort', () => {
      reader.cancel().catch(() => {});
    });

    const run = async () => {
      try {
        while (!controller.signal.aborted) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          this.events.onAudioFrame(identity, frame.data, frame.sampleRate);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(`[bot] audio stream error for ${identity}:`, err);
        }
      }
    };
    void run();
  }

  private async mintToken(): Promise<string> {
    const token = new AccessToken(this.opts.apiKey, this.opts.apiSecret, {
      identity: this.opts.identity,
      name: this.opts.displayName,
      // 10h covers any realistic Avalon game (typical 30-60 min, worst-case
      // ~3h with many re-proposals). LiveKit caps at 7d if we ever need more.
      ttl: '10h',
    });
    token.addGrant({
      room: this.opts.roomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      hidden: true, // bot shouldn't appear in participant lists to other clients
    });
    return token.toJwt();
  }
}
