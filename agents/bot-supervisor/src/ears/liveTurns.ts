/**
 * A room's speaking turns, transcribed live (plan 2026-11-15-2100, row A).
 *
 * The speaking timer says whose turn it is (the shared TimerListener drives
 * this as its turn sink). While a person speaks, their audio goes to a live
 * recognition session; when the turn ends, the session is closed and the
 * turn's words are ready about a second later. The turn is also kept as audio:
 * if the live session fails, it is transcribed whole, as before.
 *
 * Every person's turn is reported, an empty one with no words, so a bot
 * waiting for the speaker before it knows the turn is over. Bots' turns are
 * not: each bot reports the words it said itself.
 */

import type { ActiveSpeaker, TurnSink } from '@avalon/shared';
import type { LiveSession, RecognizerFactory } from './recognizer.js';

export interface HeardTurn {
  quest: number;
  round: number;
  turnIndex: number;
  speaker: string;
  /** The words, or '' when nothing was said. */
  text: string;
  /** How the words were got: live, or by the whole-clip fallback. */
  via: 'live' | 'clip' | 'none';
  /** Milliseconds from the end of the turn to its words. */
  latencyMs: number;
  durationSec: number;
}

interface Current {
  speaker: ActiveSpeaker;
  session: LiveSession | null;
  frames: Int16Array[];
  samples: number;
  sampleRate: number;
}

export interface LiveTurnsOptions {
  recognizers: RecognizerFactory;
  isBot: (identity: string) => boolean;
  /** Whole-clip transcription, when a live session fails. */
  transcribeClip: (pcm: Int16Array, sampleRate: number) => Promise<string>;
  /** Whether a turn's audio is silence (no session result is trusted over it). */
  isSilent: (pcm: Int16Array, sampleRate: number) => boolean;
  onTurn: (turn: HeardTurn) => void;
  warn: (message: string) => void;
}

export class LiveTurns implements TurnSink {
  private current: Current | null = null;
  private readonly finishing = new Set<Promise<void>>();

  constructor(private readonly opts: LiveTurnsOptions) {}

  setActiveSpeaker(speaker: ActiveSpeaker): void {
    this.finish();
    if (this.opts.isBot(speaker.identity)) return;
    let session: LiveSession | null = null;
    try {
      session = this.opts.recognizers.open();
    } catch (err) {
      this.opts.warn(`live recognition could not start for ${speaker.displayName}: ${(err as Error).message}`);
    }
    this.current = { speaker, session, frames: [], samples: 0, sampleRate: 0 };
  }

  clearActiveSpeaker(): void {
    this.finish();
  }

  onAudioFrame(identity: string, data: Int16Array, sampleRate: number): void {
    const cur = this.current;
    if (!cur || cur.speaker.identity !== identity) return;
    if (cur.sampleRate === 0) cur.sampleRate = sampleRate;
    const copy = new Int16Array(data); // the frame's buffer may be reused
    cur.frames.push(copy);
    cur.samples += copy.length;
    cur.session?.write(copy);
  }

  /** Turns still being finished (for a clean shutdown). */
  pending(): Promise<void>[] {
    return Array.from(this.finishing);
  }

  private finish(): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    const task = this.report(cur).catch((err) => this.opts.warn(`a turn could not be reported: ${(err as Error).message}`));
    this.finishing.add(task);
    void task.finally(() => this.finishing.delete(task));
  }

  private async report(cur: Current): Promise<void> {
    const endedAt = Date.now();
    const { speaker } = cur;
    const pcm = new Int16Array(cur.samples);
    let offset = 0;
    for (const frame of cur.frames) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    const rate = cur.sampleRate || 16_000;
    const durationSec = pcm.length / rate;

    let text = '';
    let via: HeardTurn['via'] = 'none';
    const live = cur.session ? cur.session.end() : Promise.reject(new Error('no live session'));
    if (pcm.length === 0 || this.opts.isSilent(pcm, rate)) {
      await live.catch(() => '');
    } else {
      try {
        text = await live;
        via = 'live';
      } catch (err) {
        this.opts.warn(`live recognition failed for ${speaker.displayName} (${(err as Error).message}); transcribing the clip`);
        text = await this.opts.transcribeClip(pcm, rate).catch((e) => {
          this.opts.warn(`clip transcription failed too: ${(e as Error).message}`);
          return '';
        });
        via = 'clip';
      }
    }
    this.opts.onTurn({
      quest: speaker.questNumber,
      round: speaker.roundIndex,
      turnIndex: speaker.turnIndex,
      speaker: speaker.displayName,
      text: text.trim(),
      via,
      latencyMs: Date.now() - endedAt,
      durationSec,
    });
  }
}
