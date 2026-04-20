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

import type { SpeakingTimerState } from '../types.js';
import type { TurnSegmenter } from './turnSegmenter.js';

export const TIMER_TOPIC = 'speaking-timer';

export interface ParticipantResolver {
  displayName: (identity: string) => string;
}

export class TimerListener {
  private segmenter: TurnSegmenter;
  private resolver: ParticipantResolver;
  private activeSpeaker: string | null = null;

  constructor(segmenter: TurnSegmenter, resolver: ParticipantResolver) {
    this.segmenter = segmenter;
    this.resolver = resolver;
  }

  /** Swap the display-name resolver (used once the bot is ready). */
  setResolver(resolver: ParticipantResolver): void {
    this.resolver = resolver;
  }

  /** Called by the bot on every `dataReceived` matching TIMER_TOPIC. */
  onPayload(payload: Uint8Array): void {
    let state: SpeakingTimerState;
    try {
      state = JSON.parse(new TextDecoder().decode(payload)) as SpeakingTimerState;
    } catch {
      return;
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
        questNumber: state.questNumber,
        // Use the speaker index *at turn start* as the turn index within the quest.
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

  private deriveActiveSpeaker(state: SpeakingTimerState): string | null {
    if (!state.timerRunning) return null;
    const order = state.speakingOrder ?? [];
    const idx = state.currentSpeakerIndex ?? 0;
    if (idx < 0 || idx >= order.length) return null;
    return order[idx] ?? null;
  }
}
