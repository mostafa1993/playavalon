/**
 * The blind detective (plan row E, D6): after each round of talk, its read of
 * every player's role, from the public record so far.
 *
 * Each update builds the blind record (gamestate/record.ts: no role, no Lady
 * result) and cuts it at the round that just ended (`cutRecord`): that round's
 * talk and everything before it, the proposal the talk led to with its vote,
 * and a settled quest's mission and Lady of the Lake. Never the whole blind
 * record: its assassin-phase discussion, where only the evil players speak,
 * and the pick and outcome give the answer away. The detective also reads the
 * game's setup (the roles in play and how many players have each). Each read
 * is made afresh from the record so far, not from the read before, so an early
 * guess doesn't carry itself forward.
 *
 * Code checks every read against the roster and the setup (`checkRead`): each
 * player guessed once, only roles in play, no role given to more players than
 * the setup deals. A read that breaks it is asked for once more, with what
 * broke; a second break, or a failed call, keeps the read before.
 *
 * Every read is from before the assassin phase. The last is the scored read:
 * the report shows it as the detective's read, and the judge scores it.
 *
 * A tracker starts empty with its session: guess_log.json is written after
 * each round and never read back.
 */

import { buildGameRecord, cutRecord } from '../gamestate/record.js';
import type { RecordSource } from '../gamestate/recordSource.js';
import { formatRolesInPlay, roleCounts, type RolesInPlay } from '../gamestate/roleConfig.js';
import type { PipelineContext } from '../pipeline.js';
import { writeJsonAtomic } from '../storage/atomicWrite.js';
import { guessLogPath } from '../storage/layout.js';
import type { GuessLog, GuessRound, RecordPlayer, RoleGuess } from '../types.js';
import { recordText } from './finalReport.js';

/** Names compare without case, spacing, or combining marks and joiners. */
function nameKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\p{Mn}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The plain roles under the names a guess may give them. */
const ROLE_ALIASES: Record<string, string> = {
  servant: 'Loyal Servant',
  'loyal servant of arthur': 'Loyal Servant',
  'minion of mordred': 'Minion',
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * A read checked against the roster and the setup. Returns the guesses in
 * seat order, each with the player's name as the record writes it and the
 * role as the setup writes it, and what breaks the setup ([] when nothing
 * does). Without a setup, only the roster is checked.
 */
export function checkRead(
  raw: unknown,
  players: RecordPlayer[],
  setup: RolesInPlay | null | undefined
): { guesses: RoleGuess[]; problems: string[] } {
  const problems: string[] = [];
  const counts = setup ? roleCounts(setup) : null;
  const roleByKey = new Map((counts ?? []).map((r) => [nameKey(r.role), r.role]));
  const byPlayer = new Map<string, RoleGuess>();

  for (const item of Array.isArray(raw) ? raw : []) {
    const g = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = str(g.player);
    const player = players.find((p) => nameKey(p.display_name) === nameKey(name));
    if (!player) {
      problems.push(`"${name}" is not a player of this game`);
      continue;
    }
    if (byPlayer.has(player.id)) {
      problems.push(`${player.display_name} is guessed more than once`);
      continue;
    }
    const given = str(g.guessed_role);
    let role = given;
    if (counts) {
      const key = nameKey(given);
      const known = roleByKey.get(key) ?? roleByKey.get(nameKey(ROLE_ALIASES[key] ?? ''));
      if (!known)
        problems.push(`${player.display_name} is guessed as "${given}", which is not in play`);
      role = known ?? given;
    }
    byPlayer.set(player.id, {
      player: player.display_name,
      guessed_role: role,
      confidence: g.confidence as RoleGuess['confidence'],
      reasoning: str(g.reasoning),
    });
  }

  for (const p of players) {
    if (!byPlayer.has(p.id)) problems.push(`${p.display_name} has no guess`);
  }
  for (const r of counts ?? []) {
    const holders = [...byPlayer.values()].filter((g) => g.guessed_role === r.role);
    if (holders.length > r.count) {
      const who = holders.map((g) => g.player).join(', ');
      problems.push(
        `${r.role} is given to ${holders.length} players (${who}); the setup has ${r.count}`
      );
    }
  }

  const guesses = [...players]
    .sort((a, b) => a.seat_number - b.seat_number)
    .flatMap((p) => byPlayer.get(p.id) ?? []);
  return { guesses, problems };
}

function recheckText(problems: string[]): string {
  return [
    '',
    'YOUR LAST ANSWER FOR THIS ROUND BROKE THE SETUP:',
    ...problems.map((p) => `- ${p}`),
    'Answer again with a read that keeps to it.',
    '',
  ].join('\n');
}

export class GuessTracker {
  private rounds: GuessRound[] = [];
  /** Serializes guess-updates so they apply in order: a failed update keeps
   *  the read before it. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    /** The game: its folder, roster and setup, the model, the log. */
    private readonly ctx: PipelineContext,
    /** The game's rows; the blind record reads only the public ones. */
    private readonly source: RecordSource
  ) {}

  /** Run a guess-update for a completed round of talk. Serialized (so updates
   *  apply in order) and non-fatal — a failure is swallowed so it never poisons
   *  the chain or interrupts recording. */
  updateForRound(quest: number, proposalRound: number): Promise<void> {
    this.chain = this.chain
      .then(() => this.doUpdate(quest, proposalRound))
      .catch((err) => this.ctx.log.error(`guess update Q${quest}/R${proposalRound} failed`, err));
    return this.chain;
  }

  private async doUpdate(quest: number, proposalRound: number): Promise<void> {
    const { llm, dir, gameId, meta, log } = this.ctx;
    const record = cutRecord(
      await buildGameRecord(this.source, dir, gameId, 'blind'),
      quest,
      proposalRound
    );
    const vars = {
      record: recordText(record),
      roles_in_play: formatRolesInPlay(meta.rolesInPlay),
    };

    let guesses: RoleGuess[] | null = null;
    let recheck = '';
    for (let ask = 1; ask <= 2; ask += 1) {
      const out = await llm
        .runJson<{ guesses?: unknown }>('role-guess-update.yml', { ...vars, recheck })
        .catch((err) => {
          log.error(`guess update Q${quest}/R${proposalRound}: the call failed`, err);
          return null;
        });
      if (!out) break;
      const read = checkRead(out.guesses, record.players, meta.rolesInPlay);
      if (read.problems.length === 0) {
        guesses = read.guesses;
        break;
      }
      const next = ask === 1 ? 'asking again' : 'keeping the read before';
      log.error(
        `guess update Q${quest}/R${proposalRound}: the read breaks the setup ` +
          `(${read.problems.join('; ')}); ${next}`
      );
      recheck = recheckText(read.problems);
    }

    const kept = guesses ?? this.rounds.at(-1)?.guesses ?? [];
    if (kept.length === 0) return;
    this.rounds.push({
      round: this.rounds.length + 1,
      quest,
      proposal_round: proposalRound,
      guesses: kept,
    });
    await this.persist();
  }

  private async persist(): Promise<void> {
    const log: GuessLog = {
      gameId: this.ctx.gameId,
      updatedAt: new Date().toISOString(),
      rounds: this.rounds,
    };
    await writeJsonAtomic(guessLogPath(this.ctx.dir), log);
  }

  /** The read after each round of talk (for the final report). */
  getTimeline(): GuessRound[] {
    return this.rounds;
  }

  /** The scored read: the last, from the record cut at the last round of talk,
   *  before the assassin phase. */
  scoredRead(): RoleGuess[] {
    return this.rounds.at(-1)?.guesses ?? [];
  }
}
