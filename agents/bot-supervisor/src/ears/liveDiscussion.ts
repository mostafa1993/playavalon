/**
 * The assassin discussion, heard live (plan 2026-11-15-2100, row D).
 *
 * While the discussion timer runs, each person who speaks gets a live
 * recognition session; every phrase goes to the bots as it is recognised (a
 * pause ends a phrase), and while words are being recognised the bots are told
 * that person is talking, so nobody is talked over. Bots are not listened to:
 * each bot reports what it said itself.
 *
 * Each person's audio is also kept; if their live session fails, it is
 * transcribed whole when the discussion ends, as before.
 */

import type { DiscussionSink } from '@avalon/shared';
import type { LiveSession, RecognizerFactory } from './recognizer.js';

interface Speaker {
  name: string;
  session: LiveSession | null;
  frames: Int16Array[];
  samples: number;
  sampleRate: number;
  lastTalkingAt: number;
}

export interface LiveDiscussionOptions {
  recognizers: RecognizerFactory;
  isBot: (identity: string) => boolean;
  nameOf: (identity: string) => string;
  transcribeClip: (pcm: Int16Array, sampleRate: number) => Promise<string>;
  isSilent: (pcm: Int16Array, sampleRate: number) => boolean;
  /** A phrase someone said. */
  onLine: (line: { speaker: string; text: string; via: 'live' | 'clip' }) => void;
  /** Someone is talking (sent at most every TALKING_EVERY_MS per person). */
  onTalking: (speaker: string) => void;
  warn: (message: string) => void;
}

/** How often "X is talking" is sent while X talks. */
export const TALKING_EVERY_MS = 400;

export class LiveDiscussion implements DiscussionSink {
  private active = false;
  private readonly speakers = new Map<string, Speaker>();
  private readonly finishing = new Set<Promise<void>>();

  constructor(private readonly opts: LiveDiscussionOptions) {}

  start(): void {
    this.speakers.clear();
    this.active = true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const [identity, speaker] of this.speakers) {
      const task = this.finish(speaker).catch((err) =>
        this.opts.warn(`the discussion of ${identity} could not be finished: ${(err as Error).message}`)
      );
      this.finishing.add(task);
      void task.finally(() => this.finishing.delete(task));
    }
    this.speakers.clear();
  }

  isActive(): boolean {
    return this.active;
  }

  pending(): Promise<void>[] {
    return Array.from(this.finishing);
  }

  onAudioFrame(identity: string, data: Int16Array, sampleRate: number): void {
    if (!this.active || this.opts.isBot(identity)) return;
    let speaker = this.speakers.get(identity);
    if (!speaker) {
      speaker = this.open(identity, sampleRate);
      this.speakers.set(identity, speaker);
    }
    const copy = new Int16Array(data);
    speaker.frames.push(copy);
    speaker.samples += copy.length;
    speaker.session?.write(copy);
  }

  private open(identity: string, sampleRate: number): Speaker {
    const name = this.opts.nameOf(identity);
    const speaker: Speaker = { name, session: null, frames: [], samples: 0, sampleRate, lastTalkingAt: 0 };
    try {
      speaker.session = this.opts.recognizers.open({
        onPhrase: (text) => this.opts.onLine({ speaker: name, text, via: 'live' }),
        onSpeaking: () => {
          const now = Date.now();
          if (now - speaker.lastTalkingAt < TALKING_EVERY_MS) return;
          speaker.lastTalkingAt = now;
          this.opts.onTalking(name);
        },
      });
    } catch (err) {
      this.opts.warn(`live recognition could not start for ${name} in the discussion: ${(err as Error).message}`);
    }
    return speaker;
  }

  /** Close a person's session (its last phrase goes out live); if it failed, transcribe their audio whole. */
  private async finish(speaker: Speaker): Promise<void> {
    if (speaker.session) {
      try {
        await speaker.session.end();
        return;
      } catch (err) {
        this.opts.warn(`live recognition failed for ${speaker.name} in the discussion (${(err as Error).message}); transcribing the clip`);
      }
    }
    const pcm = new Int16Array(speaker.samples);
    let offset = 0;
    for (const frame of speaker.frames) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    if (pcm.length === 0 || this.opts.isSilent(pcm, speaker.sampleRate)) return;
    const text = (await this.opts.transcribeClip(pcm, speaker.sampleRate)).trim();
    if (text) this.opts.onLine({ speaker: speaker.name, text, via: 'clip' });
  }
}
