/**
 * The reviewer's pipeline: every step from a finished turn to the final report.
 * The live service (index.ts) runs them as the game goes; the replay
 * (replay.ts) runs the same steps after speech-to-text on a stored game.
 *
 *   per turn:        STT (live only) → proofreading (with the table's names)
 *                    → turn file, flagged when its confidence is low
 *   per round:       the blind detective's guess update (GuessTracker), from
 *                    the public record so far
 *   assassin phase:  the discussion (reviewer/discussionProcessor.ts)
 *   at the end:      record.json, then the final report from it, in Persian
 *                    (reviewer/finalReport.ts), checked against the record
 *                    (reviewer/checkReport.ts) → summary.fa.json, then
 *                    translated into English → summary.en.json (none when
 *                    the translation fails: the report is Persian only)
 */

import fs from 'node:fs/promises';
import { createLLMClient, isSilent, transcribe, type LLMClient } from '@avalon/shared';
import type { AgentConfig, PipelineConfig } from './config.js';
import { buildGameRecord } from './gamestate/record.js';
import type { RecordSource } from './gamestate/recordSource.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { checkPath, recordPath, summaryPath, turnPath } from './storage/layout.js';
import { checkReport } from './reviewer/checkReport.js';
import { isLowConfidence } from './reviewer/confidence.js';
import { correctTranscript } from './reviewer/transcriptCorrector.js';
import { translateReport, writeBlindReport, writeGodReport } from './reviewer/finalReport.js';
import type { GuessTracker } from './reviewer/guessTracker.js';
import type {
  GameMetaSnapshot,
  GameRecord,
  RawTurnJson,
  RecordedTurn,
  SummaryJson,
  TurnJson,
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
  /** Below this STT confidence a transcript is flagged low_confidence
   *  (LOW_CONFIDENCE_THRESHOLD). */
  lowConfidenceThreshold: number;
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

/** `Q<quest>/R<round>/<turn>`, as the logs name a turn. */
export function turnLabel(turn: { questNumber: number; roundIndex: number; turnIndex: number }): string {
  return `Q${turn.questNumber}/R${turn.roundIndex}/${turn.turnIndex}`;
}

/**
 * Live: one recorded turn through STT (or the silence skip), then the steps
 * after STT.
 */
export async function processTurn(
  config: AgentConfig,
  ctx: PipelineContext,
  turn: RecordedTurn
): Promise<void> {
  const { log } = ctx;
  log.info(
    `turn ${turnLabel(turn)} speaker=${turn.speakerDisplayName} (${turn.durationSec.toFixed(1)}s)`
  );

  // 1. STT (or silence skip). The silence check avoids a round-trip to Azure
  //    for clips that clearly contain no speech, saving cost and sparing the
  //    LLM stage garbage input.
  const silent = isSilent(turn.pcm, turn.sampleRate, config.audio.silenceRmsThreshold);
  if (silent) {
    log.info(`turn ${turnLabel(turn)} skipped STT (no 100 ms window reaches the silence threshold)`);
  }

  const { transcript: rawTranscript, confidence } = silent
    ? { transcript: '', confidence: null }
    : await transcribe(
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

  await processRawTurn(ctx, raw);
}

/**
 * The steps after STT for one turn: proofreading, the low-confidence flag and
 * the turn file.
 */
export async function processRawTurn(ctx: PipelineContext, turn: RawTurnJson): Promise<void> {
  const { llm, log, meta } = ctx;

  // 2. LLM proofreading pass on the STT output, with the table's names and the
  //    game's words. Fixes misheard words and names, wrong verb persons,
  //    Persian half-space / number artifacts before the text reaches the
  //    record and the report. Fails soft — we keep the raw transcript on error.
  let transcript = turn.transcript_raw;
  let transcriptCorrected = false;
  if (ctx.correction && turn.transcript_raw.trim().length > 0) {
    try {
      transcript = await correctTranscript(llm, turn.transcript_raw, meta.players);
      transcriptCorrected = true;
    } catch (err) {
      log.error(`transcript correction failed for ${turnLabel(turn)}, using raw STT`, err);
    }
  }

  // 3. Persist the turn file.
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
    low_confidence: isLowConfidence(turn.confidence, ctx.lowConfidenceThreshold),
    language: turn.language,
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
 * A written report checked against the record it was written from: the
 * statements the check flags are rewritten once, and the check is written to
 * check.fa.json. A failed check keeps the report as written; statements the
 * check never answered for are kept as written and logged as unchecked.
 */
async function checkedReport(
  ctx: PipelineContext,
  record: GameRecord,
  summary: SummaryJson
): Promise<SummaryJson> {
  const { log } = ctx;
  try {
    const { summary: checked, check } = await checkReport(ctx.llm, record, summary, log);
    await writeJsonAtomic(checkPath(ctx.dir, summary.language), check);
    const flagged = check.statements.filter((s) => s.flagged).length;
    const unchecked = check.statements.filter((s) => !s.checked);
    log.info(
      `report check (${summary.language}): ${flagged} of ${check.statements.length} statements flagged and rewritten`
    );
    if (unchecked.length > 0) {
      log.error(
        `report check (${summary.language}): ${unchecked.length} statements unchecked, kept as written: ` +
          unchecked.map((s) => `[${s.id}] ${s.text}`).join(' | ')
      );
    }
    return checked;
  } catch (err) {
    log.error(`report check (${summary.language}) failed; the report is kept as written`, err);
    return summary;
  }
}

/**
 * The final report from the game record: written once, in Persian, checked
 * against the record → summary.fa.json, then translated into English from the
 * checked Persian report → summary.en.json. God mode: the narrative, quest
 * commentary and performance notes. Blind mode: the narrative and quest
 * commentary from the blind record, with the detective's reads, its scored
 * read last. Returns the two paths; the English one is null when the
 * translation failed, and the report is Persian only.
 */
export async function generateFinalReport(
  ctx: PipelineContext,
  record: GameRecord,
  guessTracker: GuessTracker | null
): Promise<{ faPath: string; enPath: string | null }> {
  const { llm, log, meta } = ctx;
  log.info(`writing the ${record.mode} report from the record`);

  const written: SummaryJson =
    record.mode === 'god'
      ? await writeGodReport(llm, record, meta.roomCode)
      : await writeBlindReport(
          llm,
          record,
          {
            rolesInPlay: meta.rolesInPlay,
            timeline: guessTracker?.getTimeline() ?? [],
            finalGuesses: guessTracker?.scoredRead() ?? [],
          },
          meta.roomCode
        );
  const fa = await checkedReport(ctx, record, written);
  // The players' report, kept whatever becomes of its translation.
  const faPath = summaryPath(ctx.dir, 'fa');
  await writeJsonAtomic(faPath, fa);

  log.info('translating the checked report into English');
  const enPath = summaryPath(ctx.dir, 'en');
  try {
    await writeJsonAtomic(enPath, await translateReport(llm, record, fa, log));
    return { faPath, enPath };
  } catch (err) {
    log.error('the translation failed; the report is in Persian only', err);
    // No English from an earlier run beside this Persian report.
    await fs.rm(enPath, { force: true });
    return { faPath, enPath: null };
  }
}
