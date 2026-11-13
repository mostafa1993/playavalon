/**
 * Replay: every step after speech-to-text, run again on a stored game, into a
 * run folder of its own, as of the time each step ran live (plan D19).
 *
 * A run folder starts with the inputs only — each turn file and the
 * assassin-phase discussion reduced to what speech-to-text produced, and a
 * meta.json built from the export (role-free in blind mode). The pipeline
 * (pipeline.ts) then writes what the live service writes, reading the
 * export's rows where the live service reads the database (gameReads.ts).
 *
 * As of the time:
 *   - a turn's summary is grounded on the proposal standing when the turn
 *     ended — the latest of its quest created by then, as getLatestProposal
 *     gave it live;
 *   - each player's dossier takes their turns in order;
 *   - the blind detective updates after each round of talk, in order, once the
 *     round's turn files are written;
 *   - a quest is synthesized once its turn files are written, from its rows;
 *   - then the discussion, record.json and the final report, as at game end.
 * Last, record.god.json: the god record the judge scores against, written
 * after every model step so no blind step can see a role.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { LLMClient } from '@avalon/shared';
import { exportGameReads, exportMetaSnapshot, exportProposalAt } from './gamestate/gameReads.js';
import { buildGameRecord } from './gamestate/record.js';
import { exportRecordSource, type ExportedGame, type ProposalRow } from './gamestate/recordSource.js';
import {
  generateFinalReport,
  runQuestSynthesis,
  summarizeRawTurn,
  turnLabel,
  updateTurnDossier,
  writeGameRecord,
  type GameLog,
  type PipelineContext,
} from './pipeline.js';
import { processRawDiscussion } from './reviewer/discussionProcessor.js';
import { GuessTracker } from './reviewer/guessTracker.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { discussionPath, metaPath, turnPath } from './storage/layout.js';
import type {
  DiscussionJson,
  GameMetaSnapshot,
  MetaJson,
  RawDiscussionJson,
  RawTurnJson,
  TurnJson,
  TurnSummary,
} from './types.js';

export type ReplayMode = 'god' | 'blind';

/** Written last in each run folder, for the judge. */
export const GOD_RECORD_FILE = 'record.god.json';

const TURN_FILE = /^turn_(\d+)_(\d+)_(\d+)\.json$/;
/** Turn files from before the round segment (commit f23759d): each round's
 *  talk overwrote the last, so the game's talk is not all there. */
const OLD_TURN_FILE = /^turn_\d+_\d+\.json$/;

/** A stored game's inputs, as speech-to-text left them. */
export interface ReplayInputs {
  /** In order of quest, round and turn. */
  turns: RawTurnJson[];
  discussion: RawDiscussionJson | null;
}

/** A turn file reduced to what speech-to-text produced. */
export function rawTurn(t: TurnJson): RawTurnJson {
  return {
    gameId: t.gameId,
    questNumber: t.questNumber,
    roundIndex: t.roundIndex,
    turnIndex: t.turnIndex,
    speakerIdentity: t.speakerIdentity,
    speakerDisplayName: t.speakerDisplayName,
    startedAt: t.startedAt,
    durationSec: t.durationSec,
    sampleRate: t.sampleRate,
    transcript_raw: t.transcript_raw,
    confidence: t.confidence,
    language: t.language,
  };
}

/** The discussion reduced to the recording and what speech-to-text produced. */
export function rawDiscussion(d: DiscussionJson): RawDiscussionJson {
  return {
    gameId: d.gameId,
    startedAt: d.startedAt,
    durationSec: d.durationSec,
    assassinIdentity: d.assassinIdentity,
    speakers: d.speakers.map((s) => ({
      identity: s.identity,
      display_name: s.display_name,
      durationSec: s.durationSec,
      sampleRate: s.sampleRate,
      transcript_raw: s.transcript_raw,
      confidence: s.confidence,
    })),
  };
}

/** Read a stored game folder's turn files and discussion. Refuses turn files
 *  named without a round segment. */
export async function readInputs(folder: string): Promise<ReplayInputs> {
  const entries = await fs.readdir(folder);
  const old = entries.filter((name) => OLD_TURN_FILE.test(name));
  if (old.length > 0) {
    throw new Error(
      `${folder} has turn files without a round segment (${old.slice(0, 3).join(', ')}${
        old.length > 3 ? ', …' : ''
      }): they are named turn_<quest>_<idx>.json, from before rounds were filed ` +
        'separately, and each round overwrote the last. Only games whose turn files ' +
        'are named turn_<quest>_<round>_<idx>.json can be replayed.'
    );
  }

  const named = entries.flatMap((name) => {
    const m = TURN_FILE.exec(name);
    return m ? [{ name, quest: Number(m[1]), round: Number(m[2]), turn: Number(m[3]) }] : [];
  });
  named.sort((a, b) => a.quest - b.quest || a.round - b.round || a.turn - b.turn);
  const turns = await Promise.all(
    named.map(async ({ name }) =>
      rawTurn(JSON.parse(await fs.readFile(path.join(folder, name), 'utf8')) as TurnJson)
    )
  );

  let discussion: RawDiscussionJson | null = null;
  try {
    const stored = JSON.parse(await fs.readFile(discussionPath(folder), 'utf8')) as DiscussionJson;
    discussion = rawDiscussion(stored);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return { turns, discussion };
}

/** The shipped summary.fa.json, or null when the game has none. */
export async function readShippedSummary(folder: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(folder, 'summary.fa.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * The mode to replay a game in (plan D13): `--mode` when given; otherwise the
 * game's mode — except a game reviewed before migration 025, whose database
 * reads blind though its report was god-mode, and whose shipped summary has
 * no `mode` key: god.
 */
export function replayMode(
  exported: ExportedGame,
  shippedSummary: Record<string, unknown> | null,
  override?: ReplayMode
): ReplayMode {
  if (override) return override;
  if (shippedSummary && !('mode' in shippedSummary)) return 'god';
  return exported.room.ai_review_mode;
}

/**
 * The rounds of talk the live service closed, in order — each a guess update
 * in blind mode. A quest has a round per proposal (each new leader opens one)
 * and per round of turn files; the intro (quest 0) has its turn files' rounds.
 */
export function roundsOf(
  turns: RawTurnJson[],
  proposals: ProposalRow[]
): Array<{ quest: number; round: number }> {
  const count = new Map<number, number>();
  const atLeast = (quest: number, n: number) =>
    count.set(quest, Math.max(count.get(quest) ?? 0, n));
  for (const t of turns) atLeast(t.questNumber, t.roundIndex + 1);
  const proposalsPerQuest = new Map<number, number>();
  for (const p of proposals) {
    proposalsPerQuest.set(p.quest_number, (proposalsPerQuest.get(p.quest_number) ?? 0) + 1);
  }
  for (const [quest, n] of proposalsPerQuest) atLeast(quest, n);
  return [...count.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([quest, n]) => Array.from({ length: n }, (_, round) => ({ quest, round })));
}

/** When a turn's audio ended. */
export function turnEnd(turn: RawTurnJson): Date {
  return new Date(Date.parse(turn.startedAt) + turn.durationSec * 1000);
}

/**
 * When the live service read a turn's proposal: it flushed the turn when the
 * next speaker started, so that start time when the round has a next turn,
 * else the turn's audio end. `turns` is in quest, round, turn order.
 */
export function turnProcessedAt(turns: RawTurnJson[], i: number): Date {
  const turn = turns[i]!;
  const next = turns[i + 1];
  if (next && next.questNumber === turn.questNumber && next.roundIndex === turn.roundIndex) {
    return new Date(next.startedAt);
  }
  return turnEnd(turn);
}

/**
 * Write a run folder's inputs: the turn files and discussion as speech-to-text
 * left them, and meta.json. Refuses a folder that already holds anything.
 */
export async function prepareRunFolder(
  runDir: string,
  inputs: ReplayInputs,
  meta: GameMetaSnapshot
): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  const existing = await fs.readdir(runDir);
  if (existing.length > 0) {
    throw new Error(`Run folder ${runDir} is not empty; each run needs a new folder.`);
  }
  const metaJson: MetaJson = { ...meta, agentStartedAt: new Date().toISOString() };
  await writeJsonAtomic(metaPath(runDir), metaJson);
  for (const t of inputs.turns) {
    await writeJsonAtomic(turnPath(runDir, t.questNumber, t.roundIndex, t.turnIndex), t);
  }
  if (inputs.discussion) await writeJsonAtomic(discussionPath(runDir), inputs.discussion);
}

export interface ReplayRunOptions {
  llm: LLMClient;
  /** Run the proofreading pass (TRANSCRIPT_CORRECTION_ENABLED). */
  correction: boolean;
  exported: ExportedGame;
  /** The game's stored folder: turn files, discussion.json. */
  sourceDir: string;
  /** A new, empty folder for this run. */
  runDir: string;
  mode: ReplayMode;
  /** Turns processed at once. */
  concurrency: number;
  log: GameLog;
}

/** One replay of one game into `runDir`. */
export async function replayRun(opts: ReplayRunOptions): Promise<void> {
  const { exported, runDir, mode, log } = opts;
  const gameId = exported.game.id;
  const inputs = await readInputs(opts.sourceDir);
  const meta = exportMetaSnapshot(exported, mode);
  await prepareRunFolder(runDir, inputs, meta);

  const ctx: PipelineContext = {
    llm: opts.llm,
    reads: exportGameReads(exported),
    correction: opts.correction,
    gameId,
    dir: runDir,
    mode,
    meta,
    log,
  };
  const guessTracker = mode === 'blind' ? new GuessTracker(opts.llm, runDir, meta) : null;
  const limit = limiter(opts.concurrency);
  const roundKey = (quest: number, round: number) => `${quest}/${round}`;

  // Per turn: proofreading, summary and turn file; then the speaker's dossier,
  // after their previous turn's.
  const written = new Map<string, Array<Promise<void>>>();
  const lastDossier = new Map<string, Promise<void>>();
  const turnTasks = inputs.turns.map((turn, i) => {
    let markWritten!: () => void;
    const turnWritten = new Promise<void>((resolve) => (markWritten = resolve));
    const key = roundKey(turn.questNumber, turn.roundIndex);
    written.set(key, [...(written.get(key) ?? []), turnWritten]);

    const previousDossier = lastDossier.get(turn.speakerIdentity) ?? Promise.resolve();
    const task = limit(async () => {
      log.info(
        `turn ${turnLabel(turn)} speaker=${turn.speakerDisplayName} (${turn.durationSec.toFixed(1)}s)`
      );
      let summary: TurnSummary | undefined;
      try {
        summary = await summarizeRawTurn(
          ctx,
          turn,
          exportProposalAt(exported, turn.questNumber, turnProcessedAt(inputs.turns, i))
        );
      } catch (err) {
        log.error(`turn ${turnLabel(turn)} failed`, err);
      } finally {
        markWritten();
      }
      await previousDossier;
      if (summary) await updateTurnDossier(ctx, turn, summary);
    });
    lastDossier.set(turn.speakerIdentity, task);
    return task;
  });

  // Per round, in order: the detective's update once the round's turns are
  // written. Per quest: its synthesis once its turns are written.
  const rounds = roundsOf(inputs.turns, exported.proposals ?? []);
  let guesses = Promise.resolve();
  if (guessTracker) {
    for (const { quest, round } of rounds) {
      const talk = written.get(roundKey(quest, round)) ?? [];
      guesses = Promise.all([guesses, ...talk]).then(() =>
        guessTracker.updateForRound(quest, round)
      );
    }
  }
  const quests = [...new Set(rounds.map((r) => r.quest))].filter((q) => q > 0);
  const syntheses = quests.map(async (quest) => {
    const talk = rounds
      .filter((r) => r.quest === quest)
      .flatMap((r) => written.get(roundKey(r.quest, r.round)) ?? []);
    await Promise.all(talk);
    await runQuestSynthesis(ctx, quest).catch((err) =>
      log.error(`quest ${quest} synthesis failed`, err)
    );
  });

  await Promise.all([...turnTasks, guesses, ...syntheses]);

  // The game's end: the assassin-phase discussion, the record, the report.
  if (inputs.discussion) {
    await processRawDiscussion(ctx, inputs.discussion).catch(async (err) => {
      log.error('discussion processor failed', err);
      // Live leaves no discussion.json when processing fails; don't leave the
      // raw input where the record and the report would read it as processed.
      await fs.rm(discussionPath(ctx.dir), { force: true });
    });
  }
  try {
    await writeGameRecord(ctx, exportRecordSource(exported));
    log.info('game record written');
  } catch (err) {
    log.error('game record failed', err);
  }
  await generateFinalReport(ctx, guessTracker);
  log.info('final report generated');

  await writeJsonAtomic(
    path.join(runDir, GOD_RECORD_FILE),
    await buildGameRecord(exportRecordSource(exported), runDir, gameId, 'god')
  );
}

/** Run at most `n` tasks at once, in the order they were given. */
function limiter(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n) return;
    const start = queue.shift();
    if (!start) return;
    active += 1;
    start();
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}
