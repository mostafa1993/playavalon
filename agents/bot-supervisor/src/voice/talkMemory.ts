/**
 * TalkMemory — everything said at the table, turn by turn, as the smart bot
 * heard it (its own statements included, as it said them).
 *
 * A turn is filed under the quest and the round of talk it belongs to: the
 * round is the speaking timer's count of leader changes within the quest, so
 * round r is the talk about the quest's proposal r+1 (the leader proposes,
 * then the table talks, then it votes). Quest 0 is the intro round.
 *
 * The assassin-phase discussion (evil players talking freely, no timer turns)
 * is kept apart, in the order heard.
 *
 * Nothing is trimmed: a whole game is far below the model's context window,
 * and the early quests matter to the end.
 */

export interface TalkTurn {
  quest: number;
  round: number;
  speaker: string;
  text: string;
}

export interface DiscussionLine {
  speaker: string;
  text: string;
}

export class TalkMemory {
  private readonly turns: TalkTurn[] = [];
  private readonly discussionLines: DiscussionLine[] = [];

  addTurn(quest: number, round: number, speaker: string, text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.turns.push({ quest, round, speaker, text: clean });
  }

  addDiscussion(speaker: string, text: string): void {
    const clean = text.trim();
    if (clean) this.discussionLines.push({ speaker, text: clean });
  }

  /** Every turn so far, in the order heard. */
  all(): readonly TalkTurn[] {
    return this.turns;
  }

  /** The assassin-phase discussion so far. */
  discussion(): readonly DiscussionLine[] {
    return this.discussionLines;
  }

  /** Everything heard so far (turns and discussion lines). */
  get size(): number {
    return this.turns.length + this.discussionLines.length;
  }
}
