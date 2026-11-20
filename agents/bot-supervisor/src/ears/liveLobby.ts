/**
 * The lobby, heard live (plan 2026-11-20 lobby talk, row A, D1–D2).
 *
 * Before the game begins, people chat in the room's voice. A person's audio
 * opens a live recognition session when it gets loud enough to be speech —
 * starting with the moment before, so the first word isn't cut — and the
 * session closes after a pause: a quiet lobby streams nothing. Each phrase
 * goes to the bots as it is recognised, and while a person talks the bots are
 * told so, to keep from talking over them. Bots aren't listened to: each bot
 * reports what it said itself.
 *
 * The ears stop listening to the lobby once the game has begun (its first
 * speaking-timer message).
 */

import type { LiveSession, RecognizerFactory } from './recognizer.js';

export interface LiveLobbyOptions {
  recognizers: RecognizerFactory;
  isBot: (identity: string) => boolean;
  nameOf: (identity: string) => string;
  /** A phrase someone said. */
  onLine: (line: { speaker: string; text: string }) => void;
  /** Someone is talking (at most every TALKING_EVERY_MS per person). */
  onTalking: (speaker: string) => void;
  /** A frame this loud (RMS) or louder is speech. */
  talkingRms: number;
  warn: (message: string) => void;
  /** A session closes after this long without speech (default PAUSE_MS). */
  pauseMs?: number;
}

/** The pause after which a person's session closes. */
export const PAUSE_MS = 1_500;
/** Audio kept from before speech starts, so its first word isn't cut. */
const PRE_ROLL_MS = 400;
const TALKING_EVERY_MS = 400;
const SWEEP_MS = 250;

interface Speaker {
  name: string;
  session: LiveSession | null;
  /** Recent audio while no session is open (the pre-roll). */
  ring: Int16Array[];
  ringSamples: number;
  lastLoudAt: number;
  lastTalkingAt: number;
}

export class LiveLobby {
  private active = true;
  private readonly speakers = new Map<string, Speaker>();
  private readonly closing = new Set<Promise<void>>();
  private readonly sweep: ReturnType<typeof setInterval>;
  private readonly pauseMs: number;

  constructor(private readonly opts: LiveLobbyOptions) {
    this.pauseMs = opts.pauseMs ?? PAUSE_MS;
    // A muted microphone sends no frames: close sessions by the clock too.
    this.sweep = setInterval(() => this.closeQuiet(Date.now()), SWEEP_MS);
  }

  isActive(): boolean {
    return this.active;
  }

  /** The game has begun: close every session and stop listening to the lobby. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    clearInterval(this.sweep);
    for (const s of this.speakers.values()) this.close(s);
    this.speakers.clear();
  }

  pending(): Promise<void>[] {
    return Array.from(this.closing);
  }

  onAudioFrame(identity: string, data: Int16Array, sampleRate: number): void {
    if (!this.active || this.opts.isBot(identity)) return;
    let s = this.speakers.get(identity);
    if (!s) {
      s = { name: this.opts.nameOf(identity), session: null, ring: [], ringSamples: 0, lastLoudAt: 0, lastTalkingAt: 0 };
      this.speakers.set(identity, s);
    }
    const frame = new Int16Array(data);
    const now = Date.now();
    const loud = rms(frame) >= this.opts.talkingRms;

    if (!s.session) {
      s.ring.push(frame);
      s.ringSamples += frame.length;
      const keep = (sampleRate * PRE_ROLL_MS) / 1000;
      while (s.ring.length > 1 && s.ringSamples - s.ring[0]!.length >= keep) s.ringSamples -= s.ring.shift()!.length;
      if (!loud) return;
      const name = s.name;
      try {
        s.session = this.opts.recognizers.open({ onPhrase: (text) => this.opts.onLine({ speaker: name, text }) });
      } catch (err) {
        this.opts.warn(`live recognition could not start for ${name} in the lobby: ${(err as Error).message}`);
        return;
      }
      for (const f of s.ring) s.session.write(f);
      s.ring = [];
      s.ringSamples = 0;
    } else {
      s.session.write(frame);
    }
    if (loud) {
      s.lastLoudAt = now;
      if (now - s.lastTalkingAt >= TALKING_EVERY_MS) {
        s.lastTalkingAt = now;
        this.opts.onTalking(s.name);
      }
    } else if (now - s.lastLoudAt > this.pauseMs) {
      this.close(s);
    }
  }

  private closeQuiet(now: number): void {
    for (const s of this.speakers.values()) if (s.session && now - s.lastLoudAt > this.pauseMs) this.close(s);
  }

  /** End a person's session: its last phrase still goes out (through onPhrase). */
  private close(s: Speaker): void {
    const session = s.session;
    if (!session) return;
    s.session = null;
    const task = session
      .end()
      .then(() => {})
      .catch((err) => this.opts.warn(`live recognition failed for ${s.name} in the lobby: ${(err as Error).message}`));
    this.closing.add(task);
    void task.finally(() => this.closing.delete(task));
  }
}

function rms(pcm: Int16Array): number {
  let sum = 0;
  for (const x of pcm) sum += x * x;
  return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}
