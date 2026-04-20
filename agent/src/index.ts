/**
 * Entrypoint for the AI reviewer agent.
 *
 * Lifecycle:
 *   1. Watcher polls Supabase for an active game with AI review enabled.
 *   2. On start: agent upserts `game_reviews` row (status='recording'),
 *      writes meta.json, joins the LiveKit room as a hidden bot,
 *      and begins buffering + transcribing turns.
 *   3. Per turn: STT → summarizer → dossier update → write turn JSON (with summary).
 *   4. On quest boundary: synthesize the completed quest → write quest_<n>.json.
 *   5. On end: flush in-flight turns, synthesize the final quest, disconnect.
 *
 * Single concurrent game is assumed by product decision.
 */

import { loadConfig, type AgentConfig } from './config.js';
import {
  createDbClient,
  getLatestProposal,
  insertGameReviewRecording,
  loadGameOutcome,
  loadMetaSnapshot,
  updateGameReview,
} from './gamestate/db.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { startWatcher } from './gamestate/watcher.js';
import type { ActiveGameRow } from './gamestate/db.js';
import { LiveKitBot } from './bot/livekitBot.js';
import { TurnSegmenter } from './bot/turnSegmenter.js';
import { TimerListener } from './bot/timerListener.js';
import { transcribe } from './stt/azureSpeech.js';
import { isSilent } from './stt/silence.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { metaPath, summaryPath, turnPath } from './storage/layout.js';
import { createLLMClient, type LLMClient } from './reviewer/llm.js';
import { summarizeTurn } from './reviewer/turnSummarizer.js';
import { updateDossier } from './reviewer/playerDossier.js';
import { synthesizeQuest } from './reviewer/questSynthesizer.js';
import { renderRoleReveal } from './reviewer/roleRevealRenderer.js';
import {
  generateFinalNarrative,
  loadAllDossiers,
  loadAllQuestJsons,
} from './reviewer/finalNarrative.js';
import type {
  GameMetaSnapshot,
  MetaJson,
  RecordedTurn,
  SummaryJson,
  TurnJson,
  TurnSummary,
} from './types.js';

interface Session {
  gameId: string;
  roomCode: string;
  meta: GameMetaSnapshot;
  bot: LiveKitBot;
  segmenter: TurnSegmenter;
  timerListener: TimerListener;
  /** Tracks in-flight per-turn pipelines so we can await them on session end. */
  pendingTurns: Set<Promise<void>>;
  /** Tracks in-flight quest synthesis calls. */
  pendingQuests: Set<Promise<void>>;
}

function buildSessionLogger(gameId: string) {
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

async function startSession(
  config: AgentConfig,
  db: SupabaseClient,
  llm: LLMClient,
  game: ActiveGameRow
): Promise<Session> {
  const log = buildSessionLogger(game.id);
  log.info(`starting session for room ${game.room_code}`);

  // 1. Claim the game_reviews row (status=recording).
  await insertGameReviewRecording(db, game.id);

  // 2. Snapshot players/roles and write meta.json.
  const meta = await loadMetaSnapshot(db, game.id);
  const metaJson: MetaJson = {
    ...meta,
    agentStartedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(metaPath(config.storage.dataDir, game.id), metaJson);

  // 3. Set up segmenter, timer listener, then bot.
  const pendingTurns = new Set<Promise<void>>();
  const pendingQuests = new Set<Promise<void>>();

  const onTurnFinished = (turn: RecordedTurn) => {
    const task = processTurn(config, db, llm, game.id, meta, turn).catch((err) => {
      log.error(`turn Q${turn.questNumber}/${turn.turnIndex} failed`, err);
    });
    pendingTurns.add(task);
    void task.finally(() => pendingTurns.delete(task));
  };
  const segmenter = new TurnSegmenter(onTurnFinished);

  const metaByIdentity = new Map(meta.players.map((p) => [p.id, p.display_name]));

  const onQuestChanged = (fromQuest: number, _toQuest: number) => {
    const task = runQuestSynthesisWhenReady(
      config,
      db,
      llm,
      game.id,
      fromQuest,
      pendingTurns,
      metaByIdentity
    ).catch((err) => log.error(`quest ${fromQuest} synthesis failed`, err));
    pendingQuests.add(task);
    void task.finally(() => pendingQuests.delete(task));
  };

  const timerListener = new TimerListener(
    segmenter,
    { displayName: (identity) => metaByIdentity.get(identity) ?? identity },
    onQuestChanged
  );

  const bot = new LiveKitBot(
    {
      wsUrl: config.livekit.url,
      apiKey: config.livekit.apiKey,
      apiSecret: config.livekit.apiSecret,
      roomName: game.room_code,
      identity: `${config.livekit.botIdentityPrefix}${game.id}`,
      displayName: 'AI Reviewer',
      sampleRate: config.audio.sampleRate,
      channels: config.audio.channels,
    },
    {
      onAudioFrame: (identity, data, sr) => segmenter.onAudioFrame(identity, data, sr),
      onTimerData: (payload) => timerListener.onPayload(payload),
    }
  );

  timerListener.setResolver({
    displayName: (identity) =>
      bot.displayNameFor(identity) || metaByIdentity.get(identity) || identity,
  });

  await bot.join();
  log.info('bot joined LiveKit room');

  return {
    gameId: game.id,
    roomCode: game.room_code,
    meta,
    bot,
    segmenter,
    timerListener,
    pendingTurns,
    pendingQuests,
  };
}

async function endSession(
  config: AgentConfig,
  db: SupabaseClient,
  llm: LLMClient,
  session: Session
): Promise<void> {
  const log = buildSessionLogger(session.gameId);
  log.info('ending session');

  // Flush any in-flight turn — finalize() clears the active speaker which
  // triggers onTurnFinished → pipeline adds to pendingTurns.
  session.timerListener.finalize();

  if (session.pendingTurns.size > 0) {
    log.info(`waiting for ${session.pendingTurns.size} pending turn pipeline(s)`);
    await Promise.allSettled(Array.from(session.pendingTurns));
  }

  // Synthesize the final quest (the one in-progress at end-of-game that never
  // triggered an onQuestChanged increment).
  const finalQuest = session.timerListener.getLastSeenQuest();
  if (finalQuest > 0) {
    const metaByIdentity = new Map(session.meta.players.map((p) => [p.id, p.display_name]));
    try {
      await synthesizeQuest(llm, db, {
        dataDir: config.storage.dataDir,
        gameId: session.gameId,
        questNumber: finalQuest,
        playerNames: metaByIdentity,
      });
      log.info(`synthesized final quest ${finalQuest}`);
    } catch (err) {
      log.error(`final quest ${finalQuest} synthesis failed`, err);
    }
  }

  // Wait for any quest syntheses triggered earlier that are still running.
  if (session.pendingQuests.size > 0) {
    log.info(`waiting for ${session.pendingQuests.size} pending quest synthesis call(s)`);
    await Promise.allSettled(Array.from(session.pendingQuests));
  }

  // Leave LiveKit as soon as recording is fully wrapped up — no reason to
  // stay connected during LLM work.
  await session.bot.leave().catch((err) => log.error('bot.leave failed', err));

  // Generate the final report: role reveal + narrative, per language.
  try {
    await updateGameReview(db, session.gameId, { status: 'generating' });
    await generateFinalReport(config, db, llm, session);
    log.info('final report generated');
  } catch (err) {
    log.error('final report generation failed', err);
    await updateGameReview(db, session.gameId, {
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
    }).catch((updateErr) => log.error('failed to mark review as failed', updateErr));
  }

  log.info('session closed');
}

async function generateFinalReport(
  config: AgentConfig,
  db: SupabaseClient,
  llm: LLMClient,
  session: Session
): Promise<void> {
  const log = buildSessionLogger(session.gameId);
  const [outcome, quests, dossiers] = await Promise.all([
    loadGameOutcome(db, session.gameId),
    loadAllQuestJsons(config.storage.dataDir, session.gameId),
    loadAllDossiers(config.storage.dataDir, session.gameId),
  ]);

  // All four LLM calls in parallel — they're independent.
  log.info('invoking role-reveal + final-narrative prompts (fa + en)');
  const [roleRevealFa, roleRevealEn, narrativeFa, narrativeEn] = await Promise.all([
    renderRoleReveal(llm, session.meta, 'fa'),
    renderRoleReveal(llm, session.meta, 'en'),
    generateFinalNarrative(llm, { meta: session.meta, outcome, dossiers, quests }, 'fa'),
    generateFinalNarrative(llm, { meta: session.meta, outcome, dossiers, quests }, 'en'),
  ]);

  const build = (
    language: 'fa' | 'en',
    roleReveal: string,
    narrative: string
  ): SummaryJson => ({
    language,
    gameId: session.gameId,
    roomCode: session.roomCode,
    generatedAt: new Date().toISOString(),
    outcome,
    players: session.meta.players.map((p) => ({
      id: p.id,
      display_name: p.display_name,
      seat_number: p.seat_number,
      role: p.role,
      special_role: p.special_role,
    })),
    role_reveal: roleReveal,
    narrative,
    quests,
  });

  const faPath = summaryPath(config.storage.dataDir, session.gameId, 'fa');
  const enPath = summaryPath(config.storage.dataDir, session.gameId, 'en');

  await Promise.all([
    writeJsonAtomic(faPath, build('fa', roleRevealFa, narrativeFa)),
    writeJsonAtomic(enPath, build('en', roleRevealEn, narrativeEn)),
  ]);

  await updateGameReview(db, session.gameId, {
    status: 'ready',
    summary_fa_path: faPath,
    summary_en_path: enPath,
    error_message: null,
  });
}

async function processTurn(
  config: AgentConfig,
  db: SupabaseClient,
  llm: LLMClient,
  gameId: string,
  meta: GameMetaSnapshot,
  turn: RecordedTurn
): Promise<void> {
  const log = buildSessionLogger(gameId);
  log.info(
    `turn Q${turn.questNumber}/${turn.turnIndex} speaker=${turn.speakerDisplayName} (${turn.durationSec.toFixed(1)}s)`
  );

  // 1. STT (or silence skip) + proposal context fetch in parallel.
  //    The silence check avoids a round-trip to Azure for clips that clearly
  //    contain no speech, saving cost and sparing the LLM stage garbage input.
  const silent = isSilent(turn.pcm, config.audio.silenceRmsThreshold);
  if (silent) {
    log.info(
      `turn Q${turn.questNumber}/${turn.turnIndex} skipped STT (RMS below silence threshold)`
    );
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

  const [{ transcript, confidence }, proposalCtx] = await Promise.all([
    sttPromise,
    getLatestProposal(db, gameId, turn.questNumber).catch((err) => {
      log.error(`latest proposal fetch failed for Q${turn.questNumber}`, err);
      return null;
    }),
  ]);

  // 2. Summarize (skip on empty transcript).
  let summary: TurnSummary | undefined;
  if (transcript.trim().length > 0) {
    try {
      const speaker = meta.players.find((p) => p.id === turn.speakerIdentity);
      const nameOf = (id: string) =>
        meta.players.find((p) => p.id === id)?.display_name ?? id;
      const leaderName = proposalCtx ? nameOf(proposalCtx.leaderId) : 'unknown';
      const proposedTeam = proposalCtx
        ? proposalCtx.teamMemberIds.map(nameOf).join(', ')
        : 'unknown';
      summary = await summarizeTurn(llm, {
        questNumber: turn.questNumber,
        turnIndex: turn.turnIndex,
        speakerDisplayName: turn.speakerDisplayName,
        speakerSeat: speaker?.seat_number ?? null,
        leaderDisplayName: leaderName,
        proposedTeam,
        seatTable: buildSeatTable(meta),
        transcript,
      });
    } catch (err) {
      log.error(`summarizer failed for Q${turn.questNumber}/${turn.turnIndex}`, err);
    }
  }

  // 3. Persist the turn file (with or without summary).
  const out: TurnJson = {
    gameId,
    questNumber: turn.questNumber,
    turnIndex: turn.turnIndex,
    speakerIdentity: turn.speakerIdentity,
    speakerDisplayName: turn.speakerDisplayName,
    startedAt: turn.startedAt.toISOString(),
    durationSec: Number(turn.durationSec.toFixed(2)),
    sampleRate: turn.sampleRate,
    transcript,
    confidence,
    language: config.azureSpeech.language,
    summary,
  };
  await writeJsonAtomic(
    turnPath(config.storage.dataDir, gameId, turn.questNumber, turn.turnIndex),
    out
  );

  // 4. Update the speaker's dossier (only when we have a summary to feed it).
  if (summary) {
    try {
      const speaker = meta.players.find((p) => p.id === turn.speakerIdentity);
      await updateDossier(llm, {
        dataDir: config.storage.dataDir,
        gameId,
        playerId: turn.speakerIdentity,
        playerDisplayName: turn.speakerDisplayName,
        playerSeat: speaker?.seat_number ?? null,
        questNumber: turn.questNumber,
        turnIndex: turn.turnIndex,
        turnSummary: summary,
      });
    } catch (err) {
      log.error(`dossier update failed for ${turn.speakerDisplayName}`, err);
    }
  }
}

/**
 * Run quest synthesis, but first wait for any in-flight turn pipelines for
 * THIS quest to finish writing their JSON files — otherwise the synthesizer
 * would read partial data.
 */
async function runQuestSynthesisWhenReady(
  config: AgentConfig,
  db: SupabaseClient,
  llm: LLMClient,
  gameId: string,
  questNumber: number,
  pendingTurns: Set<Promise<void>>,
  playerNames: Map<string, string>
): Promise<void> {
  if (pendingTurns.size > 0) {
    await Promise.allSettled(Array.from(pendingTurns));
  }
  await synthesizeQuest(llm, db, {
    dataDir: config.storage.dataDir,
    gameId,
    questNumber,
    playerNames,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log('[agent] booting; data dir:', config.storage.dataDir);

  const db = createDbClient(config.supabase.url, config.supabase.serviceRoleKey);
  const llm = createLLMClient(config);
  let session: Session | null = null;

  const watcher = startWatcher(db, config.polling.gameWatcherMs, {
    onGameStart: async (game) => {
      session = await startSession(config, db, llm, game);
    },
    onGameEnd: async (_gameId) => {
      if (!session) return;
      const s = session;
      session = null;
      await endSession(config, db, llm, s);
    },
  });

  const shutdown = async (signal: string) => {
    console.log(`[agent] received ${signal}, shutting down`);
    watcher.stop();
    if (session) await endSession(config, db, llm, session).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
