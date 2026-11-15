/**
 * TalkClock — the speaking timer as the bot sees it on the LiveKit data
 * channel: whether a round of talk is running now, when that last changed,
 * and whether it ran at any moment since a given time. The vote timing reads
 * it (brains/voteTiming.ts).
 */

export class TalkClock {
  private running = false;
  private changedAt = 0;
  /** The last moment the timer was known to be running. */
  private lastRunAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Each speaking-timer broadcast: is a speaker's clock running? */
  onState(running: boolean): void {
    const t = this.now();
    if (running !== this.running) {
      if (this.running) this.lastRunAt = t; // it ran until now
      this.running = running;
      this.changedAt = t;
    }
    if (running) this.lastRunAt = t;
  }

  /** Whether the timer ran at any moment since `t`. */
  ranSince(t: number): boolean {
    return this.running || this.lastRunAt >= t;
  }

  /** Whether the timer is stopped, and has been for at least `ms`. */
  stoppedFor(ms: number): boolean {
    return !this.running && this.now() - this.changedAt >= ms;
  }
}
