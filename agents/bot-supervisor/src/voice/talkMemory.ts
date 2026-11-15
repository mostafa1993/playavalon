/**
 * TalkMemory — everything said at the table, turn by turn, as the smart bot
 * heard it (its own statements included, as it said them).
 *
 * A turn is filed under the quest and the round of talk it belongs to: the
 * round is the speaking timer's count of leader changes within the quest, so
 * round r is the talk about the quest's proposal r+1 (the leader proposes,
 * then the table talks, then it votes). Quest 0 is the intro round. A turn
 * also keeps its place in the speaking order, and a turn in which nothing was
 * said is noted as over (a bot waiting on the speaker before it needn't wait).
 *
 * The assassin-phase discussion (evil players talking freely, no timer turns)
 * is kept apart, in the order heard, each line marked if a bot said it.
 *
 * Nothing is trimmed: a whole game is far below the model's context window,
 * and the early quests matter to the end. `version` counts what has been
 * heard, so a statement drafted earlier can tell what is new since.
 */

export interface TalkTurn {
  quest: number;
  round: number;
  turnIndex: number;
  speaker: string;
  text: string;
}

export interface DiscussionLine {
  speaker: string;
  text: string;
  fromBot: boolean;
}

export class TalkMemory {
  private readonly turns: TalkTurn[] = [];
  private readonly discussionLines: DiscussionLine[] = [];
  private readonly over = new Set<string>();

  /** A turn's words; '' when nothing was said (the turn is still noted as over). */
  addTurn(quest: number, round: number, turnIndex: number, speaker: string, text: string): void {
    this.over.add(`${quest}:${round}:${turnIndex}`);
    const clean = text.trim();
    if (clean) this.turns.push({ quest, round, turnIndex, speaker, text: clean });
  }

  /** A discussion line; returns it (a bot's own line is recorded as it starts, and may be corrected). */
  addDiscussion(speaker: string, text: string, fromBot: boolean): DiscussionLine | null {
    const clean = text.trim();
    if (!clean) return null;
    const line = { speaker, text: clean, fromBot };
    this.discussionLines.push(line);
    return line;
  }

  /** Take back a line recorded as it started but never said. */
  removeDiscussion(line: DiscussionLine | null): void {
    const i = line ? this.discussionLines.indexOf(line) : -1;
    if (i >= 0) this.discussionLines.splice(i, 1);
  }

  /** Whether this turn's words (or its silence) have been heard. */
  heard(quest: number, round: number, turnIndex: number): boolean {
    return this.over.has(`${quest}:${round}:${turnIndex}`);
  }

  /** Every turn so far, in the order heard. */
  all(): readonly TalkTurn[] {
    return this.turns;
  }

  /** The turns heard after `version` (a value of `version` read earlier). */
  turnsSince(version: number): readonly TalkTurn[] {
    return this.turns.slice(Math.min(version, this.turns.length));
  }

  /** The assassin-phase discussion so far. */
  discussion(): readonly DiscussionLine[] {
    return this.discussionLines;
  }

  /** How many turns with words have been heard: what turnsSince() counts from. */
  get version(): number {
    return this.turns.length;
  }

  /** Everything heard so far (turns and discussion lines). */
  get size(): number {
    return this.turns.length + this.discussionLines.length;
  }
}
