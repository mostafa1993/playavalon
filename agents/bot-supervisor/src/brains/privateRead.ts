/**
 * The smart bot's private read of the table: what it believes about every
 * other player, its plan, the public line it has taken (an evil bot's cover
 * story), and its view of the team on the table. Every move and every speech
 * reads the latest one, so the bot's words and votes follow one judgement.
 *
 * ReadKeeper updates it in the background (private-read.yml, Gemini 4 Carbon
 * on HIGH: a minute or more per update) whenever something new has happened —
 * a turn of talk, a vote, a quest, a phase. One update runs at a time; events
 * during it make one more update, on the newest state, when it ends. A failed
 * update keeps the previous read.
 */

import type { LLMClient } from '@avalon/shared';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { AgentLogger } from '../util/logger.js';
import type { SmartView } from './smartView.js';

export interface PrivateRead {
  players: Array<{ name: string; read: 'good' | 'evil' | 'unsure'; role: string | null; why: string }>;
  plan: string;
  public_line: string;
  current_team: string;
}

/** Changes whenever there is something new to read: a phase, a proposal, a vote, a quest, a turn of talk. */
export function stateKey(observation: Observation, talkTurns: number): string {
  const g = observation.game;
  if (!g) return `lobby|${talkTurns}`;
  return [g.phase, g.current_quest, g.vote_track, g.current_proposal?.id ?? '-', talkTurns].join('|');
}

/** Where the game stood when a read was written, for the prompts that use it. */
export function asOf(observation: Observation, talkTurns: number): string {
  const g = observation.game;
  if (!g) return `the intro, after ${talkTurns} turn(s) of talk`;
  return `quest ${g.current_quest}, phase ${g.phase}, after ${talkTurns} turn(s) of talk in the game`;
}

export function renderRead(read: PrivateRead | null, when: string | null): string {
  if (!read) return '(no read yet: judge from the game so far)';
  const players = read.players.map(
    (p) => `- ${p.name}: ${p.read}${p.role ? `, maybe ${p.role}` : ''} — ${p.why}`
  );
  return [
    `Written at ${when}; the game so far may have moved on since.`,
    ...players,
    `Your plan: ${read.plan}`,
    `What you have said at the table (don't contradict it): ${read.public_line}`,
    `On the team: ${read.current_team}`,
  ].join('\n');
}

function isRead(x: unknown): x is PrivateRead {
  const r = x as PrivateRead;
  return (
    !!r &&
    Array.isArray(r.players) &&
    r.players.every((p) => typeof p?.name === 'string' && ['good', 'evil', 'unsure'].includes(p.read)) &&
    typeof r.plan === 'string' &&
    typeof r.public_line === 'string' &&
    typeof r.current_team === 'string'
  );
}

export class ReadKeeper {
  private read: PrivateRead | null = null;
  private when: string | null = null;
  private lastKey: string | null = null;
  private running: Promise<void> | null = null;
  private pending: { identity: Identity; observation: Observation } | null = null;
  /** Updates finished, for logs and tests. */
  updates = 0;

  constructor(
    private readonly deps: {
      llm: () => LLMClient | null;
      smart: SmartView;
      seatTable: (identity: Identity, observation: Observation) => string;
      logger: AgentLogger;
    }
  ) {}

  /** The latest read, rendered for a prompt. */
  rendered(): string {
    return renderRead(this.read, this.when);
  }

  /** Called on every engine tick: starts an update when something new has happened. */
  notice(identity: Identity, observation: Observation): void {
    if (observation.game?.phase === 'game_over') return;
    const key = stateKey(observation, this.deps.smart.talk.size);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.pending = { identity, observation };
    if (!this.running) this.running = this.drain();
  }

  /** Resolves when no update is running or waiting (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const { identity, observation } = this.pending;
        this.pending = null;
        await this.update(identity, observation);
      }
    } finally {
      this.running = null;
    }
  }

  private async update(identity: Identity, observation: Observation): Promise<void> {
    const llm = this.deps.llm();
    if (!llm) return;
    const talkTurns = this.deps.smart.talk.size;
    const started = Date.now();
    try {
      const out = await llm.runJson<unknown>('private-read.yml', {
        brief: this.deps.smart.brief(identity, observation),
        seat_table: this.deps.seatTable(identity, observation),
        game_so_far: await this.deps.smart.gameSoFar(observation),
        previous_read: this.rendered(),
      });
      if (!isRead(out)) throw new Error('the read came back in the wrong shape');
      this.read = out;
      this.when = asOf(observation, talkTurns);
      this.updates += 1;
      this.deps.logger.info(
        `[read] updated in ${Math.round((Date.now() - started) / 1000)} s (${this.when}): ` +
          `${out.players.map((p) => `${p.name}=${p.read}`).join(', ')} | team: ${out.current_team}`
      );
    } catch (err) {
      this.deps.logger.warn(`[read] update failed, keeping the previous read: ${(err as Error).message}`);
    }
  }
}
