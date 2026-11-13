/**
 * The reviewer's pipeline: every step from a finished turn to the final report.
 * The live service (index.ts) runs them as the game goes; the replay
 * (replay.ts) runs the same steps after speech-to-text on a stored game.
 *
 *   per turn:        STT (live only) → proofreading → turn summary →
 *                    turn file → the speaker's dossier
 *   per round:       the blind detective's guess update (GuessTracker)
 *   per quest:       quest synthesis
 *   assassin phase:  the discussion (reviewer/discussionProcessor.ts)
 *   at the end:      record.json, then the final report (summary.<lang>.json)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLLMClient, isSilent, transcribe, type LLMClient } from '@avalon/shared';
import type { AgentConfig, PipelineConfig } from './config.js';
import { getLatestProposal, type LatestProposal } from './gamestate/db.js';
import type { GameReads } from './gamestate/gameReads.js';
import { buildGameRecord } from './gamestate/record.js';
import type { RecordSource } from './gamestate/recordSource.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { recordPath, summaryPath, turnPath } from './storage/layout.js';
import { correctTranscript } from './reviewer/transcriptCorrector.js';
import { summarizeTurn } from './reviewer/turnSummarizer.js';
import { updateDossier } from './reviewer/playerDossier.js';
import { synthesizeQuest } from './reviewer/questSynthesizer.js';
import { renderRoleReveal } from './reviewer/roleRevealRenderer.js';
import {
  generateFinalNarrative,
  loadAllDossiers,
  loadAllQuestJsons,
  loadDiscussion,
} from './reviewer/finalNarrative.js';
import { generateBlindSummary } from './reviewer/finalNarrativeBlind.js';
import { generatePerformanceEval } from './reviewer/performanceEval.js';
import type { GuessTracker } from './reviewer/guessTracker.js';
import type {
  BlindSummaryJson,
  GameMetaSnapshot,
  GameRecord,
  GodSummaryJson,
  PlayerPerformance,
  RawTurnJson,
  RecordedTurn,
  TurnJson,
  TurnSummary,
} from './types.js';

export interface GameLog {
  info: (msg: string, extra?: unknown) => void;
  error: (msg: string, err?: unknown) => void;
}

/** What every step works with: one game, its folder and its reads. */
export interface PipelineContext {
  llm: LLMClient;
  reads: GameReads;
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
 * Live: one recorded turn through STT (or the silence skip), with the
 * quest's latest proposal read beside it as the turn ends; then the steps
 * after STT.
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
        }
      );

  const [{ transcript: rawTranscript, confidence }, proposal] = await Promise.all([
    sttPromise,
    getLatestProposal(db, ctx.gameId, turn.questNumber).catch((err) => {
      log.error(`latest proposal fetch failed for Q${turn.questNumber}`, err);
      return null;
    }),
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

  const summary = await summarizeRawTurn(ctx, raw, proposal);
  if (summary) await updateTurnDossier(ctx, raw, summary);
}

/**
 * The steps after STT for one turn: proofreading, the summary grounded on
 * `proposal` (the one standing when the turn ended), and the turn file.
 * Returns the summary; undefined for an empty transcript or a failed summary.
 */
export async function summarizeRawTurn(
  ctx: PipelineContext,
  turn: RawTurnJson,
  proposal: LatestProposal | null
): Promise<TurnSummary | undefined> {
  const { llm, log, meta } = ctx;

  // 2. LLM proofreading pass on the STT output. Fixes misheard words, wrong
  //    verb persons, Persian half-space / number artifacts before the text
  //    reaches the summarizer. Fails soft — we keep the raw transcript on error.
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

  // 3. Summarize (skip on empty transcript).
  let summary: TurnSummary | undefined;
  if (transcript.trim().length > 0) {
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
  return summary;
}

/** 5. Fold a turn's summary into its speaker's dossier. Fails soft. */
export async function updateTurnDossier(
  ctx: PipelineContext,
  turn: RawTurnJson,
  summary: TurnSummary
): Promise<void> {
  try {
    const speaker = ctx.meta.players.find((p) => p.id === turn.speakerIdentity);
    await updateDossier(ctx.llm, {
      dir: ctx.dir,
      playerId: turn.speakerIdentity,
      playerDisplayName: turn.speakerDisplayName,
      playerSeat: speaker?.seat_number ?? null,
      questNumber: turn.questNumber,
      roundIndex: turn.roundIndex,
      turnIndex: turn.turnIndex,
      turnSummary: summary,
    });
  } catch (err) {
    ctx.log.error(`dossier update failed for ${turn.speakerDisplayName}`, err);
  }
}

/** Synthesize a finished quest from its turn files and its rows → quest_<n>.json. */
export async function runQuestSynthesis(ctx: PipelineContext, questNumber: number): Promise<void> {
  await synthesizeQuest(ctx.llm, ctx.reads, {
    dir: ctx.dir,
    gameId: ctx.gameId,
    questNumber,
    playerNames: new Map(ctx.meta.players.map((p) => [p.id, p.display_name])),
  });
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
 * The final report, per language → summary.fa.json and summary.en.json.
 * God mode: role reveal, narrative and performance. Blind mode: the end
 * summary and the detective's guess timeline. Returns the two paths.
 */
export async function generateFinalReport(
  ctx: PipelineContext,
  guessTracker: GuessTracker | null
): Promise<{ faPath: string; enPath: string }> {
  const { llm, log, meta } = ctx;
  const [outcome, quests, dossiers, discussion] = await Promise.all([
    ctx.reads.outcome(),
    loadAllQuestJsons(ctx.dir),
    loadAllDossiers(ctx.dir),
    loadDiscussion(ctx.dir),
  ]);

  const faPath = summaryPath(ctx.dir, 'fa');
  const enPath = summaryPath(ctx.dir, 'en');

  if (ctx.mode === 'blind') {
    // BLIND: freeform end summary + the evolving guess timeline. No roles.
    const timeline = guessTracker?.getTimeline() ?? [];
    const finalGuesses = guessTracker?.getFinalGuesses() ?? [];
    log.info('invoking blind end-summary (fa + en)');
    const blindCtx = { meta, outcome, quests, dossiers, timeline, finalGuesses };
    const [summaryFa, summaryEn] = await Promise.all([
      generateBlindSummary(llm, blindCtx, 'fa'),
      generateBlindSummary(llm, blindCtx, 'en'),
    ]);
    const buildBlind = (language: 'fa' | 'en', finalSummary: string): BlindSummaryJson => ({
      mode: 'blind',
      language,
      gameId: ctx.gameId,
      roomCode: meta.roomCode,
      generatedAt: new Date().toISOString(),
      outcome,
      players: meta.players.map((p) => ({
        id: p.id,
        display_name: p.display_name,
        seat_number: p.seat_number,
      })),
      guess_timeline: timeline,
      final_guesses: finalGuesses,
      final_summary: finalSummary,
      quests,
      discussion,
    });
    await Promise.all([
      writeJsonAtomic(faPath, buildBlind('fa', summaryFa)),
      writeJsonAtomic(enPath, buildBlind('en', summaryEn)),
    ]);
  } else {
    // GOD: role reveal + narrative (roles known).
    log.info('invoking role-reveal + narrative + performance prompts (fa + en)');
    const narrativeCtx = { meta, outcome, dossiers, quests, discussion };
    const [
      roleRevealFa,
      roleRevealEn,
      narrativeFa,
      narrativeEn,
      performanceFa,
      performanceEn,
    ] = await Promise.all([
      renderRoleReveal(llm, meta, 'fa'),
      renderRoleReveal(llm, meta, 'en'),
      generateFinalNarrative(llm, narrativeCtx, 'fa'),
      generateFinalNarrative(llm, narrativeCtx, 'en'),
      generatePerformanceEval(llm, meta, outcome, quests, dossiers, 'fa'),
      generatePerformanceEval(llm, meta, outcome, quests, dossiers, 'en'),
    ]);
    const buildGod = (
      language: 'fa' | 'en',
      roleReveal: string,
      narrative: string,
      performance: PlayerPerformance[]
    ): GodSummaryJson => ({
      mode: 'god',
      language,
      gameId: ctx.gameId,
      roomCode: meta.roomCode,
      generatedAt: new Date().toISOString(),
      outcome,
      players: meta.players.map((p) => ({
        id: p.id,
        display_name: p.display_name,
        seat_number: p.seat_number,
        role: p.role ?? 'good',
        special_role: p.special_role ?? null,
      })),
      role_reveal: roleReveal,
      narrative,
      performance,
      quests,
      discussion,
    });
    await Promise.all([
      writeJsonAtomic(faPath, buildGod('fa', roleRevealFa, narrativeFa, performanceFa)),
      writeJsonAtomic(enPath, buildGod('en', roleRevealEn, narrativeEn, performanceEn)),
    ]);
  }

  return { faPath, enPath };
}
