/**
 * TalkMemory — the smart bot's running memory of the game.
 *
 * Two streams, kept in arrival order:
 *   - talk:   transcribed speaking turns ({quest, round, speaker, text})
 *   - events: game-mechanics facts the brain derives from observation deltas
 *             (proposals, vote outcomes, quest advances)
 *
 * Rendered as a single chronological log for the LLM prompts, trimmed to a
 * char budget from the OLDEST side (recent context matters most in Avalon).
 */

interface Entry {
  at: number;
  line: string;
}

export class TalkMemory {
  private entries: Entry[] = [];

  addTurn(quest: number, round: number, speaker: string, text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.entries.push({
      at: Date.now(),
      line: `[Q${quest}/R${round}] ${speaker}: ${clean}`,
    });
  }

  addEvent(text: string): void {
    this.entries.push({ at: Date.now(), line: `[game] ${text}` });
  }

  get size(): number {
    return this.entries.length;
  }

  /** Chronological log, trimmed from the oldest side to ~maxChars. */
  render(maxChars = 12_000): string {
    if (this.entries.length === 0) return '(nothing said or recorded yet)';
    const lines: string[] = [];
    let total = 0;
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const line = this.entries[i]!.line;
      total += line.length + 1;
      if (total > maxChars) {
        lines.push('[...older discussion trimmed...]');
        break;
      }
      lines.push(line);
    }
    return lines.reverse().join('\n');
  }
}
