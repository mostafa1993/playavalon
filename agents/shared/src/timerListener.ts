/**
 * Parses broadcasts on the 'speaking-timer' LiveKit data channel
 * and drives the turn segmenter.
 *
 * State model:
 *   newActiveSpeaker = state.timerRunning
 *     ? state.speakingOrder[state.currentSpeakerIndex]
 *     : null
 *
 * When newActiveSpeaker changes, emit the corresponding event.
 */

import type { TurnSegmenter } from './turnSegmenter.js';

/** Mirrors the SpeakingTimerState broadcast by src/hooks/useSpeakingTimer.ts. */
export interface SpeakingTimerState {
  speakingOrder: string[];
  currentSpeakerIndex: number;
  timerRunning: boolean;
  timerStartTime: number | null;
  timerDuration: number;
  questNumber: number;
  /** True during the one-time intro round — these turns are filed under the
   *  "intro" quest so they don't collide with Quest 1. Absent = normal round. */
  isIntro?: boolean;
}

export const TIMER_TOPIC = 'speaking-timer';

export interface ParticipantResolver {
  displayName: (identity: string) => string;
}

export type QuestChangeHandler = (fromQuest: number, toQuest: number) => void;
/** Fired when a round of talk completes — a proposal was voted, so either the
 *  leader rotates (rejected → new round) or the quest advances (approved + the
 *  mission resolved). Args are the (quest, round) that just ENDED. The final
 *  round is flushed by the caller at end-of-game (getLastSeenQuest +
 *  getCurrentRoundIndex). */
export type RoundChangeHandler = (completedQuest: number, completedRound: number) => void;

export class TimerListener {
  private segmenter: TurnSegmenter;
  private resolver: ParticipantResolver;
  private activeSpeaker: string | null = null;
  // -1 = no quest seen yet; 0 = the one-time intro round; 1+ = real quests.
  private lastQuestNumber = -1;
  private onQuestChanged: QuestChangeHandler;
  private onRoundChanged: RoundChangeHandler;
  // Round-detection state. The proposal-round counter within the current
  // quest. Bumps when the leader rotates within the same quest (= a proposal
  // got rejected and a new round starts). Resets to 0 when the quest advances.
  // `lastLeaderIdentity` is speakingOrder[0] from the last broadcast we
  // processed — comparing it to the current speakingOrder[0] is the cheapest
  // reliable signal that the leader changed.
  private currentRoundIndex = 0;
  private lastLeaderIdentity: string | null = null;

  constructor(
    segmenter: TurnSegmenter,
    resolver: ParticipantResolver,
    onQuestChanged: QuestChangeHandler = () => {},
    onRoundChanged: RoundChangeHandler = () => {}
  ) {
    this.segmenter = segmenter;
    this.resolver = resolver;
    this.onQuestChanged = onQuestChanged;
    this.onRoundChanged = onRoundChanged;
  }

  /** Swap the display-name resolver (used once the bot is ready). */
  setResolver(resolver: ParticipantResolver): void {
    this.resolver = resolver;
  }

  /** The highest quest number we've seen in a broadcast so far. */
  getLastSeenQuest(): number {
    return this.lastQuestNumber;
  }

  /** Current proposal round within the current quest (0-indexed).
   *  Exposed for diagnostics; the value is also carried on every emitted
   *  turn record. */
  getCurrentRoundIndex(): number {
    return this.currentRoundIndex;
  }

  /** Called by the bot on every `dataReceived` matching TIMER_TOPIC. */
  onPayload(payload: Uint8Array): void {
    let state: SpeakingTimerState;
    try {
      state = JSON.parse(new TextDecoder().decode(payload)) as SpeakingTimerState;
    } catch {
      return;
    }

    // Detect quest increment BEFORE driving speaker transitions, so the
    // previous quest's active speaker (if any) is flushed under the old
    // quest number by the setActiveSpeaker/clearActiveSpeaker call below.
    // The intro round is filed under "quest 0" so it never collides with Quest 1.
    const effectiveQuest = state.isIntro ? 0 : state.questNumber;

    const questAdvanced = effectiveQuest > this.lastQuestNumber;
    if (questAdvanced) {
      const previous = this.lastQuestNumber;
      // The round in progress just ended (mission resolved, or the intro closed).
      // previous >= 0 also flushes the intro round (quest 0) → the detective's
      // opening guess-update; previous = -1 (first quest ever) emits nothing.
      if (previous >= 0) {
        this.emitRoundChanged(previous, this.currentRoundIndex);
      }
      this.lastQuestNumber = effectiveQuest;
      // A new quest is by definition round 0; the new leader starts fresh.
      this.currentRoundIndex = 0;
      this.lastLeaderIdentity = null;
      // Quest synthesis runs for real quests only — never the intro (quest 0).
      if (previous > 0) {
        try {
          this.onQuestChanged(previous, effectiveQuest);
        } catch (err) {
          console.error('[timer] onQuestChanged handler threw:', err);
        }
      }
    }

    // Detect proposal-round increment WITHIN the current quest. Signal:
    // speakingOrder[0] (the leader) changed since the last broadcast we
    // processed. This rotates only on rejected proposals (and Lady-of-Lake
    // investigations, which we treat the same — a new round of discussion).
    // Skip if quest just advanced (already handled above).
    const currentLeader = state.speakingOrder?.[0] ?? null;
    if (!questAdvanced && currentLeader && this.lastLeaderIdentity !== null
        && currentLeader !== this.lastLeaderIdentity) {
      // The current round's proposal was rejected → that round just ended.
      if (this.lastQuestNumber > 0) {
        this.emitRoundChanged(this.lastQuestNumber, this.currentRoundIndex);
      }
      this.currentRoundIndex += 1;
    }
    if (currentLeader) {
      this.lastLeaderIdentity = currentLeader;
    }

    const newSpeaker = this.deriveActiveSpeaker(state);

    if (newSpeaker === this.activeSpeaker) {
      // No-op for repeated state broadcasts with same active speaker.
      return;
    }

    if (newSpeaker) {
      this.segmenter.setActiveSpeaker({
        identity: newSpeaker,
        displayName: this.resolver.displayName(newSpeaker),
        questNumber: effectiveQuest,
        // Proposal round within the quest — bumps on leader rotation so
        // each round's transcripts get unique file names.
        roundIndex: this.currentRoundIndex,
        // Speaker's position within this round's speaking order.
        turnIndex: state.currentSpeakerIndex,
        startedAt: new Date(),
      });
      this.activeSpeaker = newSpeaker;
    } else {
      // Current speaker finished; no new one yet.
      this.segmenter.clearActiveSpeaker();
      this.activeSpeaker = null;
    }
  }

  /** Called on room disconnect — flush any in-flight buffer. */
  finalize(): void {
    this.segmenter.clearActiveSpeaker();
    this.activeSpeaker = null;
  }

  private emitRoundChanged(quest: number, round: number): void {
    try {
      this.onRoundChanged(quest, round);
    } catch (err) {
      console.error('[timer] onRoundChanged handler threw:', err);
    }
  }

  private deriveActiveSpeaker(state: SpeakingTimerState): string | null {
    if (!state.timerRunning) return null;
    const order = state.speakingOrder ?? [];
    const idx = state.currentSpeakerIndex ?? 0;
    if (idx < 0 || idx >= order.length) return null;
    return order[idx] ?? null;
  }
}
