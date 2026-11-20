/**
 * TurnSpeaker — the smart bot's speaking turns (plan 2026-11-15-2100, rows C
 * and G).
 *
 * While others talk, the bot drafts its words (Hydrogen HIGH): from two
 * speakers before its slot, at the intro when it joins the voice room, and as
 * leader with the team it has just chosen. Then, for each slot:
 *
 * 1. It catches up on the speaker just before it, whose words the live ears
 *    deliver about a second after that turn ends. Usually they arrive before
 *    the host opens the bot's slot, and the bot starts composing then;
 *    otherwise it waits for them, at most CATCH_UP_MS into the slot (a turn
 *    skipped without its clock isn't waited for).
 * 2. It composes: the draft brought up to date with everything said since (and
 *    a team proposed since), streamed; the draft itself when nothing is new,
 *    or when the update has no first sentence by UPDATE_BY_MS. With no draft,
 *    its words are written then, on Hydrogen LOW. Each call is hedged by a
 *    second one if its first sentence is slow, and if nothing at all is ready
 *    by PASS_AT_MS the bot says a short pass line: never a silent turn.
 * 3. It speaks sentence by sentence, tells the other bots exactly what it said
 *    ('' for nothing), and hands the turn on.
 */

import type { LLMClient } from '@avalon/shared';
import type { SmartView } from '../brains/smartView.js';
import type { FromBot } from '../supervisor/roomRelay.js';
import type { Identity } from '../types/Identity.js';
import type { Observation } from '../types/Observation.js';
import type { AgentLogger } from '../util/logger.js';
import { generateTurnSpeech, renderNewSince, streamTurnSpeech, streamUpdatedSpeech, type SpeechArgs } from './speechGen.js';
import { PENDING, drained, firstSentence, fromSentences, joined, settled, type SentenceSource, type Started } from './streams.js';
import type { TalkMemory } from './talkMemory.js';
import { sentences, turnKey, type MyTurnInfo, type VoiceLayer } from './voiceLayer.js';

/** What the bot will say in a slot: a ready text, or a stream whose first sentence is in. */
interface Composed {
  text?: string;
  started?: Started;
}

/** Words written ahead of a slot, and what the bot knew when it wrote them. */
export interface Draft {
  text: string;
  /** The talk memory's version when it was written. */
  talkVersion: number;
  /** The team proposed (or, for a leader's opening, chosen) when it was written: its ids, sorted. */
  team: string | null;
}

export interface TurnSpeakerDeps {
  voice: VoiceLayer;
  talk: TalkMemory;
  llm: LLMClient;
  smart: SmartView;
  identity: () => Identity | null;
  fetch: () => Promise<Observation>;
  tell: (message: FromBot) => void;
  logger: AgentLogger;
  /** Other timings than the defaults below (tests). */
  timing?: Partial<TurnTiming>;
}

export interface TurnTiming {
  catchUpMs: number;
  hedgeAfterMs: number;
  updateByMs: number;
  minUpdateMs: number;
  passAtMs: number;
}

/** How long into its slot the bot waits for the words of the speaker before it. */
export const CATCH_UP_MS = 6_000;
/** A streamed call whose first sentence hasn't come in this long gets a second call alongside. */
export const HEDGE_AFTER_MS = 5_000;
/** The update's first sentence must come by this far into the slot (or MIN_UPDATE_MS after it starts), else the draft. */
export const UPDATE_BY_MS = 10_000;
const MIN_UPDATE_MS = 5_000;
/** With nothing ready this far into the slot, the bot passes. */
export const PASS_AT_MS = 30_000;
/** The words written in the slot, with no draft: Hydrogen on LOW, a short deadline. */
const QUICK_SPEECH = { model: 'gemini-4-hydrogen', thinking_level: 'LOW', timeout_seconds: 20 } as const;
/** "Sorry, I've nothing in particular this round; on to the next one." */
export const PASS_LINE = 'ببخشید، من این دور حرف خاصی ندارم. بریم نفر بعد.';

export class TurnSpeaker {
  private readonly drafts = new Map<string, Promise<Draft | null>>();
  private opening: { quest: number; draft: Promise<Draft | null> } | null = null;
  private intro: Promise<Draft | null> | null = null;
  /** My next slots, by turn key, and the words being composed for them before they open. */
  private readonly upcoming = new Map<string, MyTurnInfo>();
  private readonly composing = new Map<string, Promise<Composed | null>>();
  private readonly t: TurnTiming;

  constructor(private readonly d: TurnSpeakerDeps) {
    this.t = {
      catchUpMs: CATCH_UP_MS,
      hedgeAfterMs: HEDGE_AFTER_MS,
      updateByMs: UPDATE_BY_MS,
      minUpdateMs: MIN_UPDATE_MS,
      passAtMs: PASS_AT_MS,
      ...d.timing,
    };
  }

  /** The intro round's words need no one else's: written when the bot joins the voice room. */
  writeIntro(): void {
    this.intro = this.writeDraft({ quest: 0, round: 0, turnIndex: 0, speakers: 0 });
  }

  /** The bot is within two speakers of its slot: draft its words (a leader's opening is drafted with its team). */
  prepare(info: MyTurnInfo): void {
    const key = turnKey(info);
    this.upcoming.set(key, info);
    if (opensRound(info) || (info.quest === 0 && this.intro) || this.drafts.has(key)) return;
    this.drafts.set(key, this.writeDraft(info));
  }

  /** A turn's words (or its silence) were heard: if it was the turn just before one of my slots, compose now. */
  heardTurn(quest: number, round: number, turnIndex: number): void {
    for (const [key, info] of this.upcoming) {
      if (info.quest !== quest || info.round !== round || info.turnIndex !== turnIndex + 1 || this.composing.has(key)) continue;
      this.d.logger.info(`[turn] the speaker before me is done (Q${quest}/R${round}): composing my words before my slot opens`);
      this.composing.set(key, this.compose(info, this.takeDraft(info), Date.now()));
    }
  }

  /** As leader, draft the round's opening with the team just chosen (the proposal goes in meanwhile). */
  writeOpening(team: string[], obs: Observation): void {
    if (!obs.game) return;
    const names = team.map((id) => nameIn(obs, id)).join(', ');
    const quest = obs.game.current_quest;
    const situation = `Quest ${quest}, vote track ${obs.game.vote_track}/5. You are the leader and speak first: present your team [${names}] and why you chose it.`;
    this.opening = { quest, draft: this.writeDraft({ quest, round: 0, turnIndex: 0, speakers: 0 }, situation, teamKey(team)) };
  }

  /** My speaking slot: catch up, speak, tell the others what I said, hand the turn on. */
  async myTurn(info: MyTurnInfo): Promise<void> {
    const slotStartedAt = Date.now();
    const key = turnKey(info);
    const name = this.d.identity()?.display_name ?? 'me';
    let spoken: string | null = null;
    try {
      this.upcoming.delete(key);
      let composing = this.composing.get(key);
      this.composing.delete(key);
      if (!composing) {
        const draft = this.takeDraft(info);
        await this.catchUp(info, slotStartedAt);
        composing = this.compose(info, draft, slotStartedAt);
      }
      const words = await composing;
      const at = ((Date.now() - slotStartedAt) / 1000).toFixed(1);
      if (words?.started) {
        this.d.logger.info(`[turn] first sentence ready ${at} s into the slot`);
        spoken = await this.d.voice.speak(joined(words.started), slotStartedAt);
      } else if (words?.text) {
        this.d.logger.info(`[turn] words ready ${at} s into the slot`);
        spoken = await this.d.voice.say(words.text, slotStartedAt);
      }
    } catch (err) {
      this.d.logger.warn(`[mouth] speaking turn failed: ${(err as Error).message}`);
    } finally {
      if (spoken) this.d.logger.info(`[mouth] said (Q${info.quest}/R${info.round}): ${spoken}`);
      // Remember what I said (the ears don't hear bots), and tell the others, '' for nothing.
      this.d.talk.addTurn(info.quest, info.round, info.turnIndex, name, spoken ?? '');
      this.d.tell({ type: 'said', quest: info.quest, round: info.round, turnIndex: info.turnIndex, speaker: name, text: spoken ?? '' });
      await this.d.voice.handOn(key).catch(() => {});
    }
  }

  private takeDraft(info: MyTurnInfo): Promise<Draft | null> | undefined {
    const key = turnKey(info);
    let draft: Promise<Draft | null> | undefined;
    if (opensRound(info)) {
      if (this.opening?.quest === info.quest) draft = this.opening.draft;
      this.opening = null;
    } else if (info.quest === 0 && this.intro) {
      draft = this.intro;
      this.intro = null;
    } else {
      draft = this.drafts.get(key);
    }
    this.drafts.delete(key);
    return draft;
  }

  /** Wait (to CATCH_UP_MS into the slot) for the words of the speaker before me, if that turn ran. */
  private async catchUp(info: MyTurnInfo, slotStartedAt: number): Promise<void> {
    if (info.turnIndex === 0) return;
    const before = { quest: info.quest, round: info.round, turnIndex: info.turnIndex - 1 };
    if (!this.d.voice.turnRan(before)) return;
    const heard = () => this.d.talk.heard(before.quest, before.round, before.turnIndex);
    while (!heard() && Date.now() - slotStartedAt < this.t.catchUpMs) await sleep(50);
    const at = ((Date.now() - slotStartedAt) / 1000).toFixed(1);
    if (heard()) this.d.logger.info(`[turn] caught up: the speaker before me heard, ${at} s into the slot`);
    else this.d.logger.warn(`[turn] the speaker before me not heard by ${at} s; speaking without their words`);
  }

  /**
   * The words for a slot, composed from `startedAt` (the slot's opening, or
   * earlier when the speaker before finished first): a ready text, or a stream
   * whose first sentence is in (the rest is pulled in as it comes).
   */
  private async compose(info: MyTurnInfo, draftPromise: Promise<Draft | null> | undefined, startedAt: number): Promise<Composed | null> {
    try {
      const { talk, llm, smart, logger } = this.d;
      const identity = this.d.identity();
      if (!identity) return null;
      // No team to check (the intro, a leader's opening) and nothing said since: the draft as it
      // is, without reading the game first.
      const early = draftPromise ? await settled(draftPromise) : null;
      if (early && early !== PENDING && (info.quest === 0 || opensRound(info)) && talk.turnsSince(early.talkVersion).length === 0) {
        logger.info('[turn] the draft: nothing new since it was written');
        return { text: early.text };
      }
      const obs = await this.d.fetch();
      const args: SpeechArgs = { identity, observation: obs, smart, turn: info };
      const elapsed = () => Date.now() - startedAt;
      const hedged = (source: SentenceSource) => [
        { afterMs: 0, source },
        { afterMs: this.t.hedgeAfterMs, source },
      ];

      const teamNow = teamKey(obs.game?.current_proposal?.team_member_ids ?? null);
      // A leader's opening presents the team it chose, proposed or not yet.
      const teamChangedSince = (d: Draft) => !opensRound(info) && teamNow !== d.team;
      const ready = draftPromise ? await settled(draftPromise) : null;
      if (ready && ready !== PENDING) {
        const newTurns = talk.turnsSince(ready.talkVersion);
        const teamChanged = teamChangedSince(ready);
        if (newTurns.length === 0 && !teamChanged) {
          logger.info('[turn] the draft: nothing new since it was written');
          return { text: ready.text };
        }
        const newSince = renderNewSince(newTurns, teamNames(obs), teamChanged);
        const update = await firstSentence(
          hedged((signal) => streamUpdatedSpeech(llm, { ...args, draft: ready.text, newSince }, signal)),
          Math.max(this.t.minUpdateMs, this.t.updateByMs - elapsed())
        );
        if (update) {
          logger.info(`[turn] the draft brought up to date (${newTurns.length} turn(s)${teamChanged ? ' and the team' : ''} since; call ${update.index + 1}, ${(elapsed() / 1000).toFixed(1)} s)`);
          return { started: drained(update) };
        }
        logger.warn('[turn] the update had no sentence in time; the draft as it is');
        return { text: ready.text };
      }

      // A draft still being written races the words written now, if nothing has happened since it began.
      const pending = ready === PENDING ? draftPromise : undefined;
      const draftIfCurrent: SentenceSource = () =>
        (async function* () {
          const d = await pending;
          if (!d || talk.turnsSince(d.talkVersion).length > 0 || teamChangedSince(d)) throw new Error('no current draft');
          yield* fromSentences(sentences(d.text));
        })();
      logger.info(`[turn] no draft ready (${pending ? 'still being written: racing it' : draftPromise ? 'it failed' : 'none'}); writing the words now`);
      const tries: { afterMs: number; source: SentenceSource; aside?: boolean }[] = hedged((signal) =>
        streamTurnSpeech(llm, { ...args, override: QUICK_SPEECH }, signal)
      );
      if (pending) tries.push({ afterMs: 0, source: draftIfCurrent, aside: true });
      const fresh = await firstSentence(tries, this.t.passAtMs - elapsed());
      if (fresh) {
        const which = fresh.index === 2 ? 'the draft, finished meanwhile' : `words written now (call ${fresh.index + 1})`;
        logger.info(`[turn] ${which}, ${(elapsed() / 1000).toFixed(1)} s`);
        return { started: drained(fresh) };
      }
      const late = draftPromise ? await settled(draftPromise) : null;
      if (late && late !== PENDING) {
        logger.warn('[turn] nothing written now in time, but the draft came: that');
        return { text: late.text };
      }
      logger.warn('[turn] nothing written in time: passing the turn in a sentence');
      return { text: PASS_LINE };
    } catch (err) {
      // E.g. the game couldn't be read: a draft in hand is still better than passing.
      const draft = draftPromise ? await settled(draftPromise) : null;
      if (draft && draft !== PENDING) {
        this.d.logger.warn(`[turn] composing failed: ${(err as Error).message}; the draft as it is`);
        return { text: draft.text };
      }
      this.d.logger.warn(`[turn] composing failed: ${(err as Error).message}; passing the turn in a sentence`);
      return { text: PASS_LINE };
    }
  }

  /** Draft the words for a slot (or the situation given); null if writing failed. */
  private async writeDraft(info: MyTurnInfo, situation?: string, team?: string | null): Promise<Draft | null> {
    const started = Date.now();
    try {
      const identity = this.d.identity();
      if (!identity) return null;
      const obs = await this.d.fetch();
      const talkVersion = this.d.talk.version;
      const text = await generateTurnSpeech(this.d.llm, { identity, observation: obs, smart: this.d.smart, turn: info, situation });
      this.d.logger.info(`[mouth] draft written in ${Math.round((Date.now() - started) / 1000)} s (${sentences(text).length} sentences)`);
      if (!text) return null;
      return { text, talkVersion, team: team !== undefined ? team : teamKey(obs.game?.current_proposal?.team_member_ids ?? null) };
    } catch (err) {
      this.d.logger.warn(`[mouth] drafting the statement failed: ${(err as Error).message}`);
      return null;
    }
  }
}

/** The leader's first turn of a quest's round (the intro round has no proposal to present). */
export function opensRound(info: Pick<MyTurnInfo, 'quest' | 'turnIndex'>): boolean {
  return info.quest > 0 && info.turnIndex === 0;
}

/** A team as a comparable key: its ids, sorted. */
export function teamKey(ids: readonly string[] | null): string | null {
  return ids && ids.length ? [...ids].sort().join(',') : null;
}

function nameIn(obs: Observation, id: string): string {
  return obs.game?.players.find((p) => p.id === id)?.display_name ?? 'someone';
}

function teamNames(obs: Observation): string | null {
  const ids = obs.game?.current_proposal?.team_member_ids;
  return ids && ids.length ? ids.map((id) => nameIn(obs, id)).join(', ') : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
