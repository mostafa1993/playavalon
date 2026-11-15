/**
 * DiscussionTalk — an evil smart bot in the assassin discussion, as a
 * conversation (plan 2026-11-15-2100, row D, D4).
 *
 * The room's ears send each phrase a person says as soon as it is said, and
 * "X is talking" while they talk; other bots' lines come as they say them.
 * After each line from someone else, the bot decides whether to answer
 * (discussion-reply.yml, Hydrogen LOW, a few seconds) — when spoken to, when
 * it disagrees, or when it has a point about Merlin. A reply overtaken by
 * newer talk while it was being written is dropped and thought again. To
 * speak, the bot asks the supervisor for the floor (one bot at a time), waits
 * until nobody is talking, and says one or two sentences. It answers another
 * bot only when asked directly, and not after MAX_BOT_RUN bot lines in a row,
 * so bots don't talk among themselves while a person waits.
 *
 * Good players are muted in the discussion: only an evil bot takes part. It
 * opens with its read of who Merlin is.
 */

import type { LLMClient } from '@avalon/shared';
import type { SmartView } from '../brains/smartView.js';
import type { FromBot } from '../supervisor/roomRelay.js';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { AgentLogger } from '../util/logger.js';
import { seatTable } from '../brains/seats.js';
import type { DiscussionLine, TalkMemory } from './talkMemory.js';
import type { VoiceLayer } from './voiceLayer.js';

export interface DiscussionTalkDeps {
  voice: VoiceLayer;
  talk: TalkMemory;
  llm: LLMClient;
  smart: SmartView;
  identity: () => Identity | null;
  fetch: () => Promise<Observation>;
  tell: (message: FromBot) => void;
  logger: AgentLogger;
}

/** Bot lines in a row after which a bot no longer answers a bot. */
export const MAX_BOT_RUN = 2;
/** Nobody has been heard talking for this long: the bot may speak. */
export const QUIET_MS = 1_000;
/** How long the bot waits for quiet (or for the floor) before letting its reply go. */
const WAIT_FOR_TURN_MS = 12_000;
/** A reply is one or two sentences. */
const REPLY_SECONDS = 20;
/** The opening: a little more thought, nobody is waiting on it yet. */
const OPENING = { model: 'gemini-4-hydrogen', thinking_level: 'MEDIUM', timeout_seconds: 30 } as const;
/** A person still talking is waited for (this long at most) before deciding: a line comes in phrases. */
const SETTLE_MAX_MS = 8_000;
/** A decision not back in this long gets a second call alongside (the opening: OPENING_HEDGE_MS). */
const HEDGE_MS = 4_500;
const OPENING_HEDGE_MS = 10_000;

/** Whether the latest line calls for a decision: someone else's, and not a bot's past MAX_BOT_RUN in a row. */
export function worthDeciding(lines: readonly DiscussionLine[], me: string): boolean {
  const last = lines.at(-1);
  if (!last || last.speaker === me) return false;
  return !last.fromBot || botRun(lines) < MAX_BOT_RUN;
}

/** How many lines at the end were said by bots. */
export function botRun(lines: readonly DiscussionLine[]): number {
  let n = 0;
  for (let i = lines.length - 1; i >= 0 && lines[i]?.fromBot; i -= 1) n += 1;
  return n;
}

/** Whether anyone was heard talking within QUIET_MS of `now`. */
export function someoneTalking(lastTalking: ReadonlyMap<string, number>, now: number): boolean {
  for (const at of lastTalking.values()) if (now - at < QUIET_MS) return true;
  return false;
}

export class DiscussionTalk {
  private active = false;
  private deciding = false;
  private again = false;
  private readonly lastTalking = new Map<string, number>();
  private floorGranted: (() => void) | null = null;

  constructor(private readonly d: DiscussionTalkDeps) {}

  /** The discussion started: an evil bot joins it with its read of who Merlin is. */
  start(): void {
    const me = this.d.identity();
    if (!me || me.role !== 'evil' || this.active) return;
    this.active = true;
    void this.decide(true);
  }

  stop(): void {
    this.active = false;
    this.floorGranted?.();
  }

  /** Someone else said a line (already in the talk memory). */
  onLine(): void {
    if (!this.active) return;
    if (this.deciding) {
      this.again = true;
      return;
    }
    void this.decide(false);
  }

  /** A person is talking right now. */
  onTalking(speaker: string): void {
    this.lastTalking.set(speaker, Date.now());
  }

  /** The supervisor gave this bot the floor. */
  onFloor(): void {
    const granted = this.floorGranted;
    this.floorGranted = null;
    if (granted) granted();
    else this.d.tell({ type: 'floor-release' }); // not waiting for it any more
  }

  private async decide(opening: boolean): Promise<void> {
    this.deciding = true;
    try {
      do {
        this.again = false;
        const me = this.d.identity();
        if (!this.active || !me) return;
        // A person's line comes in phrases, one per pause: decide once they have finished.
        if (!opening) await this.untilQuiet(SETTLE_MAX_MS);
        const lines = this.d.talk.discussion();
        if (!opening && !worthDeciding(lines, me.display_name)) return;
        const heardBefore = lines.length;
        const started = Date.now();
        try {
          const reply = await this.writeHedged(me, opening);
          this.d.logger.info(`[discussion] ${reply ? 'reply' : 'staying quiet'} decided in ${((Date.now() - started) / 1000).toFixed(1)} s${opening ? ' (opening)' : ''}`);
          opening = false;
          if (this.d.talk.discussion().length !== heardBefore) {
            this.d.logger.info('[discussion] more was said meanwhile; thinking again');
            this.again = true;
            continue;
          }
          if (reply) await this.say(me, reply, heardBefore);
        } catch (err) {
          // A line heard meanwhile (again) still gets its answer.
          this.d.logger.warn(`[discussion] replying failed: ${(err as Error).message}`);
          opening = false;
        }
      } while (this.again && this.active);
    } finally {
      this.deciding = false;
    }
  }

  /** Until nobody has been heard talking for QUIET_MS, at most `maxMs`. */
  private async untilQuiet(maxMs: number): Promise<void> {
    const until = Date.now() + maxMs;
    while (someoneTalking(this.lastTalking, Date.now()) && Date.now() < until) await sleep(100);
  }

  /** write(), with a second call alongside if the first is slow (or failed); the first answer counts. */
  private writeHedged(me: Identity, opening: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      let done = false;
      let started = 0;
      let failed = 0;
      const go = () => {
        started += 1;
        this.write(me, opening).then(
          (reply) => {
            if (!done) {
              done = true;
              resolve(reply);
            }
          },
          (err) => {
            failed += 1;
            if (done || failed < started) return;
            if (started < 2) go();
            else {
              done = true;
              reject(err);
            }
          }
        );
      };
      go();
      setTimeout(() => {
        if (!done && started < 2) go();
      }, opening ? OPENING_HEDGE_MS : HEDGE_MS);
    });
  }

  private async write(me: Identity, opening: boolean): Promise<string> {
    const obs = await this.d.fetch();
    const lines = this.d.talk.discussion();
    const last = lines.at(-1);
    const out = await this.d.llm.runJson<{ reply?: string }>(
      'discussion-reply.yml',
      {
        brief: this.d.smart.brief(me, obs),
        seat_table: seatTable(me, obs),
        game_so_far: await this.d.smart.gameSoFar(obs),
        private_read: this.d.smart.privateRead(),
        discussion: lines.length ? lines.map(render).join('\n') : '(nothing yet)',
        last_line: opening || !last ? 'The discussion has just started: open it with who you think Merlin is, and why.' : render(last),
        you: me.display_name,
      },
      opening ? OPENING : undefined
    );
    return (out.reply ?? '').trim();
  }

  /** Get the floor, wait for quiet, say it; drop it if someone spoke meanwhile. */
  private async say(me: Identity, reply: string, heardBefore: number): Promise<void> {
    const granted = new Promise<void>((resolve) => {
      this.floorGranted = resolve;
    });
    this.d.tell({ type: 'floor-request' });
    const gotFloor = await Promise.race([granted.then(() => true), sleep(WAIT_FOR_TURN_MS).then(() => false)]);
    this.floorGranted = null;
    try {
      if (!gotFloor || !this.active) {
        this.d.logger.info('[discussion] no floor in time; letting the reply go');
        return;
      }
      const waitUntil = Date.now() + WAIT_FOR_TURN_MS;
      while (someoneTalking(this.lastTalking, Date.now()) && Date.now() < waitUntil) await sleep(200);
      if (this.d.talk.discussion().length !== heardBefore) {
        this.d.logger.info('[discussion] someone spoke while I waited; thinking again');
        this.again = true;
        return;
      }
      // My line goes into the record as I start it: a person who answers while I
      // speak comes after it, and is the latest line when I think again.
      const line = this.d.talk.addDiscussion(me.display_name, reply, true);
      const spoken = await this.d.voice.say(reply, Date.now(), { free: true, maxSeconds: REPLY_SECONDS });
      if (spoken) {
        if (line) line.text = spoken;
        this.d.logger.info(`[mouth] said in the discussion: ${spoken}`);
        this.d.tell({ type: 'discussed', speaker: me.display_name, text: spoken });
      } else {
        this.d.talk.removeDiscussion(line);
      }
    } finally {
      if (gotFloor) this.d.tell({ type: 'floor-release' });
    }
  }
}

function render(line: DiscussionLine): string {
  return `${line.speaker}${line.fromBot ? ' [bot]' : ''}: ${line.text}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
