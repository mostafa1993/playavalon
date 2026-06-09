/**
 * Discussion recorder — parallel audio buffering for the assassin phase.
 *
 * Unlike the regular per-turn flow (one speaker at a time via the
 * speaking-timer), during the 2-minute assassin deliberation multiple
 * evil players talk concurrently. This recorder captures every participant
 * in parallel from the moment the manager starts the discussion until
 * the timer ends or is reset.
 */

export interface RecordedDiscussionSegment {
  identity: string;
  displayName: string;
  startedAt: Date;
  durationSec: number;
  sampleRate: number;
  pcm: Int16Array;
}

export interface RecordedDiscussion {
  startedAt: Date;
  durationSec: number;
  assassinIdentity: string | null;
  speakers: RecordedDiscussionSegment[];
}

interface BufferState {
  identity: string;
  displayName: string;
  frames: Int16Array[];
  totalSamples: number;
  sampleRate: number;
}

export type DiscussionFinishedHandler = (recording: RecordedDiscussion) => void;

export class DiscussionRecorder {
  private active = false;
  private startedAt: Date | null = null;
  private durationSec = 0;
  private assassinIdentity: string | null = null;
  private buffers = new Map<string, BufferState>();
  private onFinished: DiscussionFinishedHandler;

  constructor(onFinished: DiscussionFinishedHandler) {
    this.onFinished = onFinished;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Begin a new discussion window. Any previously buffered audio is discarded. */
  start(params: {
    startedAt: Date;
    durationSec: number;
    assassinIdentity: string | null;
  }): void {
    this.active = true;
    this.startedAt = params.startedAt;
    this.durationSec = params.durationSec;
    this.assassinIdentity = params.assassinIdentity;
    this.buffers.clear();
  }

  /**
   * Stop the window and flush everything. If there is no active window this
   * is a no-op (idempotent — the timer listener may fire stop multiple times).
   */
  stop(resolveDisplayName: (identity: string) => string): void {
    if (!this.active || !this.startedAt) {
      this.active = false;
      return;
    }
    const speakers: RecordedDiscussionSegment[] = [];
    for (const buf of this.buffers.values()) {
      if (buf.totalSamples === 0 || buf.sampleRate === 0) continue;
      const pcm = new Int16Array(buf.totalSamples);
      let offset = 0;
      for (const f of buf.frames) {
        pcm.set(f, offset);
        offset += f.length;
      }
      speakers.push({
        identity: buf.identity,
        displayName: resolveDisplayName(buf.identity) || buf.displayName || buf.identity,
        startedAt: this.startedAt,
        durationSec: pcm.length / buf.sampleRate,
        sampleRate: buf.sampleRate,
        pcm,
      });
    }
    const recording: RecordedDiscussion = {
      startedAt: this.startedAt,
      durationSec: this.durationSec,
      assassinIdentity: this.assassinIdentity,
      speakers,
    };
    this.active = false;
    this.startedAt = null;
    this.buffers.clear();
    this.onFinished(recording);
  }

  /** Called by the bot on every audio frame, regardless of speaker. */
  onAudioFrame(identity: string, data: Int16Array, sampleRate: number): void {
    if (!this.active) return;
    let buf = this.buffers.get(identity);
    if (!buf) {
      buf = {
        identity,
        displayName: '',
        frames: [],
        totalSamples: 0,
        sampleRate,
      };
      this.buffers.set(identity, buf);
    }
    // Copy the frame — the SDK may reuse its underlying buffer.
    buf.frames.push(new Int16Array(data));
    buf.totalSamples += data.length;
  }
}
