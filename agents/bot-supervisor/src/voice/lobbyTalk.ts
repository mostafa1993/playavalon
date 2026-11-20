/**
 * LobbyTalk — a smart bot in the lobby, before the game (plan 2026-11-20
 * lobby talk, row B).
 *
 * The bot sits in the lobby's voice room, quiet. When a person calls it by
 * name (any spelling its config lists, as speech recognition writes it), it
 * waits for them to finish — a request comes in phrases — and answers them in
 * a sentence or two (lobby-chat.yml, Hydrogen LOW, a second call alongside if
 * the first is slow), then goes quiet again. It remembers the lobby's talk, so
 * a later call can follow on from an earlier one. The model may still stay
 * quiet when the name only came up in passing. More of the caller's words
 * while the answer is being written mean it is written again with them.
 *
 * One voice at a time: the bot asks the supervisor for the floor and waits
 * until nobody is talking. Bots answer people only, never each other. Roles
 * aren't in its prompt: nothing to let slip. Once the game begins it stops.
 */

import type { LLMClient } from '@avalon/shared';
import { renderRules } from '../brains/rules.js';
import type { FromBot } from '../supervisor/roomRelay.js';
import type { Observation } from '../types/Observation.js';
import type { AgentLogger } from '../util/logger.js';
import { hedged } from './hedge.js';
import { mentions } from './names.js';
import type { LobbyLine, TalkMemory } from './talkMemory.js';
import type { VoiceLayer } from './voiceLayer.js';

export interface LobbyTiming {
  /** Nobody heard talking for this long: the person has finished. */
  quietMs: number;
  /** The longest the bot waits for a caller to finish before answering. */
  settleMaxMs: number;
  /** An answer not written in this long gets a second call alongside. */
  hedgeMs: number;
  /** The longest the bot waits for the floor, and then for quiet. */
  waitForTurnMs: number;
}

export interface LobbyTalkDeps {
  voice: VoiceLayer;
  talk: TalkMemory;
  llm: LLMClient;
  /** The room as the bot sees it now. */
  fetch: () => Promise<Observation>;
  myId: string;
  tell: (message: FromBot) => void;
  logger: AgentLogger;
  persona: string;
  /** The spellings of its name it answers to (its display name is added). */
  callNames: readonly string[];
  timing?: Partial<LobbyTiming>;
}

const TIMING: LobbyTiming = { quietMs: 1_000, settleMaxMs: 8_000, hedgeMs: 4_500, waitForTurnMs: 15_000 };
/** An answer is one to three short sentences. */
const ANSWER_SECONDS = 25;
/** The lobby talk a prompt gets: the latest lines. */
const LOBBY_LINES = 40;

export class LobbyTalk {
  private active = false;
  private busy = false;
  private again = false;
  private myName = '';
  private names: string[] = [];
  /** Lobby lines before this index are answered or passed over. */
  private seen = 0;
  private readonly lastTalking = new Map<string, number>();
  private floorGranted: (() => void) | null = null;
  private readonly t: LobbyTiming;

  constructor(private readonly d: LobbyTalkDeps) {
    this.t = { ...TIMING, ...d.timing };
  }

  isActive(): boolean {
    return this.active;
  }

  /** The bot is in the lobby's voice room as `myName`. Calls from before now are past. */
  start(myName: string): void {
    if (this.active) return;
    this.active = true;
    this.myName = myName;
    this.names = [myName, ...this.d.callNames];
    this.seen = this.d.talk.lobby().length;
    this.d.logger.info(`[lobby] listening for my name (${this.names.join(', ')})`);
    if (!this.names.some((n) => /[\u0600-\u06ff]/.test(n))) {
      this.d.logger.warn('[lobby] no Persian spelling of my name in my config (call_names): people calling me will go unheard');
    }
  }

  /** The game has begun. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.floorGranted?.();
    this.d.logger.info('[lobby] the game has begun: no more lobby talk');
  }

  /** A lobby line arrived (already in the talk memory). */
  onLine(): void {
    if (!this.active) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    void this.run();
  }

  onTalking(speaker: string): void {
    this.lastTalking.set(speaker, Date.now());
  }

  /** The supervisor gave this bot the floor. */
  onFloor(): boolean {
    const granted = this.floorGranted;
    this.floorGranted = null;
    if (!granted) return false;
    granted();
    return true;
  }

  /** The first call to me after `seen`: a person's line that holds my name. */
  private nextCall(): { index: number; speaker: string } | null {
    const lines = this.d.talk.lobby();
    for (let i = this.seen; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (!line.fromBot && mentions(line.text, this.names)) return { index: i, speaker: line.speaker };
    }
    return null;
  }

  private async run(): Promise<void> {
    this.busy = true;
    try {
      for (;;) {
        this.again = false;
        if (!this.active) return;
        const call = this.nextCall();
        if (!call) {
          this.seen = this.d.talk.lobby().length;
          if (this.again) continue;
          return;
        }
        // A request comes in phrases: answer once the caller has finished.
        await this.untilQuiet(this.t.settleMaxMs);
        const lines = this.d.talk.lobby();
        const request = callerWords(lines, call);
        this.seen = lines.length;
        const started = Date.now();
        let answer: string;
        try {
          answer = await hedged(() => this.write(call.speaker, request), this.t.hedgeMs);
        } catch (err) {
          this.d.logger.warn(`[lobby] answering ${call.speaker} failed: ${(err as Error).message}`);
          continue;
        }
        // The caller said more while it was being written: write it again with all of it.
        if (this.d.talk.lobby().slice(this.seen).some((l) => !l.fromBot && l.speaker === call.speaker)) {
          this.d.logger.info(`[lobby] ${call.speaker} said more meanwhile; answering all of it`);
          this.seen = call.index;
          continue;
        }
        this.d.logger.info(`[lobby] ${answer ? 'answer' : 'staying quiet'} for ${call.speaker}, written in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        if (answer) await this.say(answer);
      }
    } finally {
      this.busy = false;
    }
  }

  private async write(caller: string, request: string): Promise<string> {
    const obs = await this.d.fetch();
    const players = obs.room.players
      .map((p) => `${p.display_name}${p.id === this.d.myId ? ' (you)' : p.is_bot ? ' (an AI player)' : ''}`)
      .join(', ');
    const lobby = this.d.talk
      .lobby()
      .slice(-LOBBY_LINES)
      .map((l) => `${l.speaker}: ${l.text}`)
      .join('\n');
    const out = await this.d.llm.runJson<{ reply?: string }>('lobby-chat.yml', {
      name: this.myName,
      persona: this.d.persona || `${this.myName} is friendly and good company.`,
      players,
      setup: renderRules(obs.room.role_config, obs.room.expected_players),
      lobby: lobby || '(nothing yet)',
      caller,
      request,
    });
    return (out.reply ?? '').trim();
  }

  private async untilQuiet(maxMs: number): Promise<void> {
    const until = Date.now() + maxMs;
    while (this.someoneTalking() && Date.now() < until) await sleep(100);
  }

  private someoneTalking(): boolean {
    const now = Date.now();
    for (const at of this.lastTalking.values()) if (now - at < this.t.quietMs) return true;
    return false;
  }

  /** Get the floor, wait for quiet, say it, give the floor back. */
  private async say(answer: string): Promise<void> {
    const granted = new Promise<void>((resolve) => {
      this.floorGranted = resolve;
    });
    this.d.tell({ type: 'floor-request' });
    const gotFloor = await Promise.race([granted.then(() => true), sleep(this.t.waitForTurnMs).then(() => false)]);
    this.floorGranted = null;
    try {
      if (!gotFloor || !this.active) {
        this.d.logger.info('[lobby] no floor in time; letting the answer go');
        return;
      }
      await this.untilQuiet(this.t.waitForTurnMs);
      // My line goes into the record as I start it: what's said meanwhile comes after it.
      const line = this.d.talk.addLobby(this.myName, answer, true);
      const spoken = await this.d.voice.say(answer, Date.now(), { free: true, maxSeconds: ANSWER_SECONDS });
      if (spoken) {
        if (line) line.text = spoken;
        this.d.logger.info(`[mouth] said in the lobby: ${spoken}`);
        this.d.tell({ type: 'lobby-said', speaker: this.myName, text: spoken });
      } else {
        this.d.talk.removeLobby(line);
      }
    } finally {
      if (gotFloor) this.d.tell({ type: 'floor-release' });
    }
  }
}

/** The caller's words from their call on: their lines since it, others' left out. */
export function callerWords(lines: readonly LobbyLine[], call: { index: number; speaker: string }): string {
  return lines
    .slice(call.index)
    .filter((l) => !l.fromBot && l.speaker === call.speaker)
    .map((l) => l.text)
    .join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
