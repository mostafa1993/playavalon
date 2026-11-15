/**
 * TalkClock — the speaking timer as the bot sees it on the LiveKit data
 * channel. The host's browser runs it: the host starts each speaker's clock
 * (it stops between speakers), and a round of talk is over when the index has
 * moved past the last speaker of the order (the leader, closing). The vote
 * timing reads it (brains/voteTiming.ts).
 */

export interface TimerSnapshot {
  timerRunning: boolean;
  currentSpeakerIndex: number;
  speakingOrder: string[];
}

export class TalkClock {
  private running = false;
  private changedAt = 0;
  /** The last moment the timer was known to be running. */
  private lastRunAt = 0;
  /** When the current order's last speaker finished; null while it is under way. */
  private roundDoneAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Each speaking-timer broadcast. */
  onState(state: TimerSnapshot): void {
    const t = this.now();
    if (state.timerRunning !== this.running) {
      if (this.running) this.lastRunAt = t; // it ran until now
      this.running = state.timerRunning;
      this.changedAt = t;
    }
    if (state.timerRunning) this.lastRunAt = t;
    const done = state.speakingOrder.length > 0 && state.currentSpeakerIndex >= state.speakingOrder.length;
    if (!done) this.roundDoneAt = null;
    else if (this.roundDoneAt === null) this.roundDoneAt = t;
  }

  /** Whether the timer ran at any moment since `t`. */
  ranSince(t: number): boolean {
    return this.running || this.lastRunAt >= t;
  }

  /** Whether a round of talk finished (its last speaker done) since `t`. */
  roundFinishedSince(t: number): boolean {
    return this.roundDoneAt !== null && this.roundDoneAt >= t;
  }

  /** Whether the timer is stopped, and has been for at least `ms`. */
  stoppedFor(ms: number): boolean {
    return !this.running && this.now() - this.changedAt >= ms;
  }
}
