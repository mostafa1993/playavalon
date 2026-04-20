/**
 * Turn segmenter: holds PCM frames for the currently-active speaker only.
 * When the active speaker changes, flushes the accumulated buffer as one
 * `RecordedTurn` and resets.
 *
 * The segmenter does NOT decide who the active speaker is — that comes from
 * the timer listener via `setActiveSpeaker`. It only buffers and flushes.
 */

import type { RecordedTurn } from '../types.js';

export type TurnFinishedHandler = (turn: RecordedTurn) => void;

interface ActiveState {
  identity: string;
  displayName: string;
  questNumber: number;
  turnIndex: number;
  startedAt: Date;
  frames: Int16Array[];
  totalSamples: number;
  sampleRate: number;
}

export class TurnSegmenter {
  private active: ActiveState | null = null;
  private onFinished: TurnFinishedHandler;

  constructor(onFinished: TurnFinishedHandler) {
    this.onFinished = onFinished;
  }

  /**
   * Called by the timer listener when a new speaker becomes active.
   * Any previously-active speaker is flushed first.
   */
  setActiveSpeaker(params: {
    identity: string;
    displayName: string;
    questNumber: number;
    turnIndex: number;
    startedAt: Date;
  }): void {
    this.flush();
    this.active = {
      ...params,
      frames: [],
      totalSamples: 0,
      sampleRate: 0, // set on first frame
    };
  }

  /**
   * Called by the timer listener when no one is currently speaking.
   * Flushes the active buffer (if any) as a completed turn.
   */
  clearActiveSpeaker(): void {
    this.flush();
  }

  /** Called by the bot for every audio frame from any participant. */
  onAudioFrame(identity: string, data: Int16Array, sampleRate: number): void {
    if (!this.active || this.active.identity !== identity) return;
    if (this.active.sampleRate === 0) this.active.sampleRate = sampleRate;
    // Defensive: if sample rate changes mid-turn we keep the first value — the
    // stream is configured to a fixed rate so this shouldn't happen.
    this.active.frames.push(new Int16Array(data)); // copy — underlying buffer may be reused
    this.active.totalSamples += data.length;
  }

  private flush(): void {
    if (!this.active) return;
    const a = this.active;
    this.active = null;

    if (a.totalSamples === 0 || a.sampleRate === 0) return;

    const pcm = new Int16Array(a.totalSamples);
    let offset = 0;
    for (const frame of a.frames) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    const durationSec = pcm.length / a.sampleRate;

    this.onFinished({
      questNumber: a.questNumber,
      turnIndex: a.turnIndex,
      speakerIdentity: a.identity,
      speakerDisplayName: a.displayName,
      startedAt: a.startedAt,
      durationSec,
      sampleRate: a.sampleRate,
      pcm,
    });
  }
}
