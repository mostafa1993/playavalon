/**
 * LiveKit audio publishing — the "mouth" proven by the Phase-0 spike
 * (docs/2026-06-10-llm-voice-player-plan.md).
 *
 * Publishes a microphone-source audio track fed from raw PCM. Published as
 * SOURCE_MICROPHONE so the web app's RemoteAudioSink plays it with zero app
 * changes (the sink only attaches microphone-source tracks).
 */

import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type Room,
} from '@livekit/rtc-node';

export interface AudioPublisher {
  /** Speak a PCM16 mono clip (at the publisher's sample rate); resolves after playout. */
  speak(pcm: Int16Array): Promise<void>;
  /** Unpublish and release the source. */
  close(): Promise<void>;
}

export interface PublishAudioOptions {
  sampleRate?: number; // default 48000 (WebRTC-native; matches synthesize())
  channels?: number; // default 1
  trackName?: string; // default 'voice'
}

/** Publish a mic-like audio track on an already-connected Room. */
export async function publishAudioTrack(
  room: Room,
  options: PublishAudioOptions = {}
): Promise<AudioPublisher> {
  const sampleRate = options.sampleRate ?? 48000;
  const channels = options.channels ?? 1;

  const source = new AudioSource(sampleRate, channels);
  const track = LocalAudioTrack.createAudioTrack(options.trackName ?? 'voice', source);
  const publication = await room.localParticipant?.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })
  );
  if (!publication) {
    throw new Error('publishAudioTrack: no localParticipant (room not connected?)');
  }

  const samplesPerFrame = Math.floor(sampleRate / 10); // 100ms frames

  return {
    async speak(pcm: Int16Array): Promise<void> {
      for (let off = 0; off < pcm.length; off += samplesPerFrame) {
        const end = Math.min(off + samplesPerFrame, pcm.length);
        // IMPORTANT (Phase-0 finding): each frame must be a fresh, zero-offset
        // Int16Array COPY. Passing subarray views into AudioFrame transmits
        // silence — the FFI does not honor a view's byteOffset.
        const chunk = new Int16Array(end - off);
        chunk.set(pcm.subarray(off, end));
        await source.captureFrame(new AudioFrame(chunk, sampleRate, channels, chunk.length));
      }
      await source.waitForPlayout();
    },
    async close(): Promise<void> {
      try {
        await room.localParticipant?.unpublishTrack(publication.sid!, true);
      } catch {
        // Already disconnected — nothing to unpublish.
      }
      await source.close();
    },
  };
}
