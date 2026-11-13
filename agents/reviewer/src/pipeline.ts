/**
 * The reviewer's pipeline: every step from a finished turn to the final report.
 * The live service (index.ts) runs them as the game goes; the replay
 * (replay.ts) runs the same steps after speech-to-text on a stored game.
 *
 *   per turn:        STT (live only) → proofreading → (blind) turn summary →
 *                    turn file
 *   per round:       the blind detective's guess update (GuessTracker)
 *   assassin phase:  the discussion (reviewer/discussionProcessor.ts)
 *   at the end:      record.json, then the final report from it
 *                    (reviewer/finalReport.ts → summary.<lang>.json)
 *
 * The turn summary feeds only the blind detective; god mode writes none.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLLMClient, isSilent, transcribe, type LLMClient } from '@avalon/shared';
import type { AgentConfig, PipelineConfig } from './config.js';
import { getLatestProposal, type LatestProposal } from './gamestate/db.js';
import { buildGameRecord } from './gamestate/record.js';
import type { RecordSource } from './gamestate/recordSource.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { recordPath, summaryPath, turnPath } from './storage/layout.js';
import { correctTranscript } from './reviewer/transcriptCorrector.js';
import { summarizeTurn } from './reviewer/turnSummarizer.js';
import { writeBlindReport, writeGodReport } from './reviewer/finalReport.js';
import type { GuessTracker } from './reviewer/guessTracker.js';
import type {
  GameMetaSnapshot,
  GameRecord,
  RawTurnJson,
  RecordedTurn,
  SummaryJson,
  TurnJson,
  TurnSummary,
} from './types.js';

export interface GameLog {
  info: (msg: string, extra?: unknown) => void;
  error: (msg: string, err?: unknown) => void;
}

/** What every step works with: one game and its folder. */
export interface PipelineContext {
  llm: LLMClient;
  /** Run the proofreading pass on each transcript (TRANSCRIPT_CORRECTION_ENABLED). */
  correction: boolean;
  gameId: string;
  /** The game's folder: every file a step reads or writes is in it. */
  dir: string;
  mode: 'blind' | 'god';
  /** The roster as of the game's start; roles only in god mode. */
  meta: GameMetaSnapshot;
  log: GameLog;
}

export function createPipelineLlm(config: PipelineConfig): LLMClient {
  return createLLMClient({
    project: config.gemini.project,
    location: config.gemini.location,
    model: config.gemini.model,
    promptsDir: config.promptsDir,
    retry: config.retry,
  });
}

export function gameLog(gameId: string): GameLog {
  const prefix = `[game:${gameId.slice(0, 8)}]`;
  return {
    info: (msg: string, extra?: unknown) => {
      if (extra !== undefined) console.log(`${prefix} ${msg}`, extra);
      else console.log(`${prefix} ${msg}`);
    },
    error: (msg: string, err?: unknown) => {
      if (err !== undefined) console.error(`${prefix} ${msg}`, err);
      else console.error(`${prefix} ${msg}`);
    },
  };
}

function buildSeatTable(meta: GameMetaSnapshot): string {
  return meta.players
    .filter((p) => p.seat_number !== null)
    .sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0))
    .map((p) => `seat ${p.seat_number}: ${p.display_name}`)
    .join('\n');
}

/** `Q<quest>/R<round>/<turn>`, as the logs name a turn. */
export function turnLabel(turn: { questNumber: number; roundIndex: number; turnIndex: number }): string {
  return `Q${turn.questNumber}/R${turn.roundIndex}/${turn.turnIndex}`;
}

/**
 * Live: one recorded turn through STT (or the silence skip) — in blind mode
 * with the quest's latest proposal read beside it as the turn ends, for the
 * turn summary — then the steps after STT.
 */
export async function processTurn(
  config: AgentConfig,
  db: SupabaseClient,
  ctx: PipelineContext,
  turn: RecordedTurn
): Promise<void> {
  const { log } = ctx;
  log.info(
    `turn ${turnLabel(turn)} speaker=${turn.speakerDisplayName} (${turn.durationSec.toFixed(1)}s)`
  );

  // 1. STT (or silence skip) + proposal context fetch in parallel.
  //    The silence check avoids a round-trip to Azure for clips that clearly
  //    contain no speech, saving cost and sparing the LLM stage garbage input.
  const silent = isSilent(turn.pcm, config.audio.silenceRmsThreshold);
  if (silent) {
    log.info(`turn ${turnLabel(turn)} skipped STT (RMS below silence threshold)`);
  }

  const sttPromise: Promise<{ transcript: string; confidence: number | null }> = silent
    ? Promise.resolve({ transcript: '', confidence: null })
    : transcribe(
        {
          key: config.azureSpeech.key,
          region: config.azureSpeech.region,
          language: config.azureSpeech.language,
        },
        turn.pcm,
        turn.sampleRate,
        {
          retry: {
            maxAttempts: config.retry.maxAttempts,
            baseDelayMs: config.retry.baseDelayMs,
          },
          silenceRmsThreshold: config.audio.silenceRmsThreshold,
        }
      );

  const [{ transcript: rawTranscript, confidence }, proposal] = await Promise.all([
    sttPromise,
    ctx.mode === 'blind'
      ? getLatestProposal(db, ctx.gameId, turn.questNumber).catch((err) => {
          log.error(`latest proposal fetch failed for Q${turn.questNumber}`, err);
          return null;
        })
      : null,
  ]);

  const raw: RawTurnJson = {
    gameId: ctx.gameId,
    questNumber: turn.questNumber,
    roundIndex: turn.roundIndex,
    turnIndex: turn.turnIndex,
    speakerIdentity: turn.speakerIdentity,
    speakerDisplayName: turn.speakerDisplayName,
    startedAt: turn.startedAt.toISOString(),
    durationSec: Number(turn.durationSec.toFixed(2)),
    sampleRate: turn.sampleRate,
    transcript_raw: rawTranscript,
    confidence,
    language: config.azureSpeech.language,
  };

  await processRawTurn(ctx, raw, proposal);
}

/**
 * The steps after STT for one turn: proofreading; in blind mode, the summary
 * the detective reads, grounded on `proposal` (the one standing when the turn
 * ended); and the turn file. God mode writes no summary: nothing reads it.
 */
export async function processRawTurn(
  ctx: PipelineContext,
  turn: RawTurnJson,
  proposal: LatestProposal | null
): Promise<void> {
  const { llm, log, meta } = ctx;

  // 2. LLM proofreading pass on the STT output. Fixes misheard words, wrong
  //    verb persons, Persian half-space / number artifacts before the text
  //    reaches the record and the report. Fails soft — we keep the raw
  //    transcript on error.
  let transcript = turn.transcript_raw;
  let transcriptCorrected = false;
  if (ctx.correction && turn.transcript_raw.trim().length > 0) {
    try {
      transcript = await correctTranscript(llm, turn.transcript_raw);
      transcriptCorrected = true;
    } catch (err) {
      log.error(`transcript correction failed for ${turnLabel(turn)}, using raw STT`, err);
    }
  }

  // 3. Blind mode: summarize for the detective (skip on empty transcript).
  let summary: TurnSummary | undefined;
  if (ctx.mode === 'blind' && transcript.trim().length > 0) {
    try {
      const speaker = meta.players.find((p) => p.id === turn.speakerIdentity);
      const nameOf = (id: string) =>
        meta.players.find((p) => p.id === id)?.display_name ?? id;
      const leaderName = proposal ? nameOf(proposal.leaderId) : 'unknown';
      const proposedTeam = proposal ? proposal.teamMemberIds.map(nameOf).join(', ') : 'unknown';
      summary = await summarizeTurn(llm, {
        questNumber: turn.questNumber,
        roundIndex: turn.roundIndex,
        turnIndex: turn.turnIndex,
        speakerDisplayName: turn.speakerDisplayName,
        speakerSeat: speaker?.seat_number ?? null,
        leaderDisplayName: leaderName,
        proposedTeam,
        seatTable: buildSeatTable(meta),
        transcript,
      });
    } catch (err) {
      log.error(`summarizer failed for ${turnLabel(turn)}`, err);
    }
  }

  // 4. Persist the turn file (with or without summary).
  const out: TurnJson = {
    gameId: turn.gameId,
    questNumber: turn.questNumber,
    roundIndex: turn.roundIndex,
    turnIndex: turn.turnIndex,
    speakerIdentity: turn.speakerIdentity,
    speakerDisplayName: turn.speakerDisplayName,
    startedAt: turn.startedAt,
    durationSec: turn.durationSec,
    sampleRate: turn.sampleRate,
    transcript,
    transcript_raw: turn.transcript_raw,
    transcript_corrected: transcriptCorrected,
    confidence: turn.confidence,
    language: turn.language,
    summary,
  };
  await writeJsonAtomic(turnPath(ctx.dir, turn.questNumber, turn.roundIndex, turn.turnIndex), out);
}

/** The game record in the context's mode → record.json. */
export async function writeGameRecord(
  ctx: PipelineContext,
  source: RecordSource
): Promise<GameRecord> {
  const record = await buildGameRecord(source, ctx.dir, ctx.gameId, ctx.mode);
  await writeJsonAtomic(recordPath(ctx.dir), record);
  return record;
}

/**
 * The final report from the game record, per language → summary.fa.json and
 * summary.en.json (two runs of the same prompt). God mode: the narrative,
 * quest commentary and performance notes. Blind mode: the narrative and quest
 * commentary from the blind record, with the detective's guesses. Returns the
 * two paths.
 */
export async function generateFinalReport(
  ctx: PipelineContext,
  record: GameRecord,
  guessTracker: GuessTracker | null
): Promise<{ faPath: string; enPath: string }> {
  const { llm, log, meta } = ctx;
  log.info(`writing the ${record.mode} report from the record (fa + en)`);

  const write = (language: 'fa' | 'en'): Promise<SummaryJson> =>
    record.mode === 'god'
      ? writeGodReport(llm, record, meta.roomCode, language)
      : writeBlindReport(
          llm,
          record,
          {
            rolesInPlay: meta.rolesInPlay,
            timeline: guessTracker?.getTimeline() ?? [],
            finalGuesses: guessTracker?.getFinalGuesses() ?? [],
          },
          meta.roomCode,
          language
        );
  const [fa, en] = await Promise.all([write('fa'), write('en')]);

  const faPath = summaryPath(ctx.dir, 'fa');
  const enPath = summaryPath(ctx.dir, 'en');
  await Promise.all([writeJsonAtomic(faPath, fa), writeJsonAtomic(enPath, en)]);
  return { faPath, enPath };
}
