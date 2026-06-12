/**
 * Guess tracker — blind-mode incremental role deduction.
 *
 * After each round of talk completes, runs a guess-update LLM pass and appends a
 * structured entry to a running memory (persisted to guess_log.json each round, so
 * a crash/restart resumes from the last round). It is fed only PUBLIC signals — the
 * round's transcribed talk + its own prior guesses — never player_roles. The memory
 * carries forward, so the read evolves round to round.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { LLMClient } from '@avalon/shared';
import type {
  GameMetaSnapshot,
  GuessLog,
  GuessRound,
  RoleGuess,
  TurnJson,
  TurnSummary,
} from '../types.js';
import { gameDir, guessLogPath } from '../storage/layout.js';
import { writeJsonAtomic } from '../storage/atomicWrite.js';

interface GuessUpdateOutput {
  guesses: RoleGuess[];
}

export class GuessTracker {
  private rounds: GuessRound[] = [];
  private globalRound = 0;
  /** Serializes guess-updates so they apply in order, each building on the last. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly llm: LLMClient,
    private readonly dataDir: string,
    private readonly meta: GameMetaSnapshot
  ) {
    // Resume from a persisted log if the reviewer restarted mid-game, so the
    // evolving memory + round numbering continue rather than starting over.
    try {
      const existing = JSON.parse(
        readFileSync(guessLogPath(dataDir, meta.gameId), 'utf8')
      ) as GuessLog;
      if (Array.isArray(existing.rounds) && existing.rounds.length > 0) {
        this.rounds = existing.rounds;
        this.globalRound =
          existing.rounds[existing.rounds.length - 1]?.round ?? existing.rounds.length;
      }
    } catch {
      // No prior log (fresh game) — start empty.
    }
  }

  private seatTable(): string {
    return this.meta.players
      .map((p) => `seat ${p.seat_number ?? '?'}: ${p.display_name}`)
      .join('\n');
  }

  /** Compact prior memory: the most recent round's guesses, one line per player. */
  private priorGuessesText(): string {
    const last = this.rounds[this.rounds.length - 1];
    if (!last || last.guesses.length === 0) {
      return '(no guesses yet — this is the first round)';
    }
    return last.guesses
      .map((g) => `- ${g.player}: ${g.guessed_role} (${g.confidence}) — ${g.reasoning}`)
      .join('\n');
  }

  /** Read the per-turn summaries for one (quest, proposalRound) from disk. */
  private roundTurns(quest: number, proposalRound: number): Array<{ speaker: string; summary: TurnSummary }> {
    const dir = gameDir(this.dataDir, this.meta.gameId);
    let files: string[];
    try {
      files = readdirSync(dir).filter(
        (f) => f.startsWith(`turn_${quest}_${proposalRound}_`) && f.endsWith('.json')
      );
    } catch {
      return [];
    }
    const out: Array<{ speaker: string; summary: TurnSummary }> = [];
    for (const f of files.sort()) {
      try {
        const t = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as TurnJson;
        if (t.summary) out.push({ speaker: t.speakerDisplayName, summary: t.summary });
      } catch {
        // skip unreadable/partial files
      }
    }
    return out;
  }

  private roundTalkText(turns: Array<{ speaker: string; summary: TurnSummary }>): string {
    if (turns.length === 0) return '(no talk recorded this round)';
    return turns
      .map(({ speaker, summary: s }) => {
        const lines = [`Speaker: ${speaker}`];
        if (s.key_points.length) lines.push(`Said: ${s.key_points.join('; ')}`);
        if (s.claims.length) lines.push(`Claims: ${s.claims.join('; ')}`);
        if (s.suspicions.length)
          lines.push(`Suspects: ${s.suspicions.map((x) => `${x.target} (${x.reason})`).join('; ')}`);
        if (s.defenses.length)
          lines.push(`Defends: ${s.defenses.map((x) => `${x.subject} (${x.reason})`).join('; ')}`);
        lines.push(`Stance on the proposed team: ${s.stance}`);
        return lines.join('\n');
      })
      .join('\n\n');
  }

  /** Run a guess-update for a completed round of talk. Serialized (so updates
   *  apply in order, each building on the previous round) and non-fatal — a
   *  failure is swallowed so it never poisons the chain or interrupts recording. */
  updateForRound(quest: number, proposalRound: number): Promise<void> {
    this.chain = this.chain.then(() => this.doUpdate(quest, proposalRound)).catch(() => {});
    return this.chain;
  }

  private async doUpdate(quest: number, proposalRound: number): Promise<void> {
    const turns = this.roundTurns(quest, proposalRound);
    this.globalRound += 1;
    const roundNo = this.globalRound; // capture before any await
    const prior = this.rounds[this.rounds.length - 1]?.guesses ?? [];

    // A round with no recorded talk carries prior guesses forward unchanged —
    // nothing new to reason about, so skip the LLM call.
    if (turns.length === 0 && prior.length > 0) {
      this.rounds.push({ round: roundNo, quest, proposal_round: proposalRound, guesses: prior });
      await this.persist();
      return;
    }

    let guesses: RoleGuess[];
    try {
      const out = await this.llm.runJson<GuessUpdateOutput>('role-guess-update.yml', {
        seat_table: this.seatTable(),
        prior_guesses: this.priorGuessesText(),
        quest_number: quest,
        proposal_round: proposalRound,
        round_talk: this.roundTalkText(turns),
      });
      guesses = Array.isArray(out.guesses) ? out.guesses : [];
    } catch {
      // Non-fatal: carry prior guesses forward unchanged.
      guesses = prior;
    }
    this.rounds.push({ round: roundNo, quest, proposal_round: proposalRound, guesses });
    await this.persist();
  }

  private async persist(): Promise<void> {
    const log: GuessLog = {
      gameId: this.meta.gameId,
      updatedAt: new Date().toISOString(),
      rounds: this.rounds,
    };
    await writeJsonAtomic(guessLogPath(this.dataDir, this.meta.gameId), log);
  }

  /** The full evolution timeline (for the final report). */
  getTimeline(): GuessRound[] {
    return this.rounds;
  }

  /** The latest (end-state) guesses. */
  getFinalGuesses(): RoleGuess[] {
    return this.rounds[this.rounds.length - 1]?.guesses ?? [];
  }
}
