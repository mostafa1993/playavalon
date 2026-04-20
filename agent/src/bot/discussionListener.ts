/**
 * Parses broadcasts on the 'discussion-timer' LiveKit topic (mirror of
 * useDiscussionTimer on the client side) and drives the DiscussionRecorder.
 *
 * Also auto-stops the recording after `durationSec` in case we miss the
 * manager's "stop" broadcast (packet loss, early disconnect, etc.).
 */

import type { DiscussionRecorder } from './discussionRecorder.js';

export const DISCUSSION_TIMER_TOPIC = 'discussion-timer';

interface DiscussionTimerState {
  startedAt: number | null;
  durationSec: number;
  running: boolean;
  assassinIdentity: string | null;
}

export interface DisplayNameResolver {
  (identity: string): string;
}

export class DiscussionListener {
  private recorder: DiscussionRecorder;
  private resolveDisplayName: DisplayNameResolver;
  private autoStopHandle: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(recorder: DiscussionRecorder, resolveDisplayName: DisplayNameResolver) {
    this.recorder = recorder;
    this.resolveDisplayName = resolveDisplayName;
  }

  setResolver(resolveDisplayName: DisplayNameResolver): void {
    this.resolveDisplayName = resolveDisplayName;
  }

  onPayload(payload: Uint8Array): void {
    let state: DiscussionTimerState;
    try {
      state = JSON.parse(new TextDecoder().decode(payload)) as DiscussionTimerState;
    } catch {
      return;
    }

    if (state.running && !this.running) {
      this.running = true;
      this.recorder.start({
        startedAt: new Date(state.startedAt ?? Date.now()),
        durationSec: state.durationSec,
        assassinIdentity: state.assassinIdentity,
      });
      // Safety auto-stop a few seconds past the declared duration in case
      // the manager's "stop" broadcast doesn't reach us.
      const autoStopMs = (state.durationSec + 5) * 1000;
      this.clearAutoStop();
      this.autoStopHandle = setTimeout(() => this.stop(), autoStopMs);
    } else if (!state.running && this.running) {
      this.stop();
    }
  }

  /** Called on session end to flush any in-progress recording. */
  finalize(): void {
    if (this.running) this.stop();
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearAutoStop();
    this.recorder.stop(this.resolveDisplayName);
  }

  private clearAutoStop(): void {
    if (this.autoStopHandle) {
      clearTimeout(this.autoStopHandle);
      this.autoStopHandle = null;
    }
  }
}
