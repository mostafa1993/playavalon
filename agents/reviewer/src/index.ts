/**
 * Entrypoint for the AI reviewer agent.
 *
 * Lifecycle:
 *   1. Watcher polls Supabase for an active game with AI review enabled.
 *   2. On start: agent upserts `game_reviews` row (status='recording'),
 *      writes meta.json, joins the LiveKit room as a hidden bot,
 *      and begins buffering + transcribing turns.
 *   3. Per turn: STT → proofreading → write turn JSON.
 *      Blind mode: after each round of talk, the detective's guess update
 *      from the public record so far.
 *   4. On end: flush in-flight turns and the assassin-phase discussion,
 *      disconnect, write record.json (the game record), then the final report
 *      from it.
 *
 * On boot, before the watcher starts, the reviews a stopped reviewer left
 * unfinished are marked failed (`failStaleReviews`).
 *
 * The steps themselves are in pipeline.ts, which the replay runs too; this
 * file wires the service: watcher, LiveKit bot, sessions.
 *
 * Single concurrent game is assumed by product decision.
 */

import { loadConfig, type AgentConfig } from './config.js';
import {
  createDbClient,
  findStaleReviews,
  insertGameReviewRecording,
  loadMetaSnapshot,
  updateGameReview,
  type StaleReview,
} from './gamestate/db.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { startWatcher } from './gamestate/watcher.js';
import { dbRecordSource } from './gamestate/recordSource.js';
import type { ActiveGameRow } from './gamestate/db.js';
import { LiveKitBot } from './bot/livekitBot.js';
import { TurnSegmenter } from '@avalon/shared';
import { TimerListener } from '@avalon/shared';
import { DiscussionRecorder, type RecordedDiscussion } from './bot/discussionRecorder.js';
import { DiscussionListener } from './bot/discussionListener.js';
import { processDiscussion } from './reviewer/discussionProcessor.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { gameDir, metaPath } from './storage/layout.js';
import type { LLMClient } from '@avalon/shared';
import {
  createPipelineLlm,
  gameLog,
  generateFinalReport,
  processTurn,
  turnLabel,
  writeGameRecord,
  type PipelineContext,
} from './pipeline.js';
import { GuessTracker } from './reviewer/guessTracker.js';
import type { MetaJson, RecordedTurn } from './types.js';

interface Session {
  /** The game and its folder, which every pipeline step works with. */
  ctx: PipelineContext;
  bot: LiveKitBot;
  segmenter: TurnSegmenter;
  timerListener: TimerListener;
  discussionRecorder: DiscussionRecorder;
  discussionListener: DiscussionListener;
  /** Tracks in-flight per-turn pipelines so we can await them on session end. */
  pendingTurns: Set<Promise<void>>;
  /** Tracks in-flight discussion processing (0 or 1 at a time). */
  pendingDiscussion: Set<Promise<void>>;
  /** Blind-mode active detective (null in god mode). */
  guessTracker: GuessTracker | null;
  /** Tracks in-flight per-round guess-updates (blind only). */
  pendingGuesses: Set<Promise<void>>;
}

async function startSession(
  config: AgentConfig,
  db: SupabaseClient,
  llm: LLMClient,
  game: ActiveGameRow
): Promise<Session> {
  const log = gameLog(game.id);
  log.info(`starting session for room ${game.room_code}`);

  // 1. Claim the game_reviews row (status=recording).
  await insertGameReviewRecording(db, game.id);

  // 2. Snapshot players/roles and write meta.json.
  const dir = gameDir(config.storage.dataDir, game.id);
  const meta = await loadMetaSnapshot(db, game.id, game.ai_review_mode);
  const metaJson: MetaJson = {
    ...meta,
    agentStartedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(metaPath(dir), metaJson);

  const ctx: PipelineContext = {
    llm,
    correction: config.correction.enabled,
    lowConfidenceThreshold: config.lowConfidenceThreshold,
    gameId: game.id,
    dir,
    mode: game.ai_review_mode,
    meta,
    log,
  };

  // 3. Set up segmenter, discussion recorder, timer listeners, then bot.
  const pendingTurns = new Set<Promise<void>>();
  const pendingDiscussion = new Set<Promise<void>>();
  const pendingGuesses = new Set<Promise<void>>();
  // Blind mode only: the active detective that re-guesses each round of talk.
  const guessTracker =
    game.ai_review_mode === 'blind' ? new GuessTracker(ctx, dbRecordSource(db, game.id)) : null;

  const onTurnFinished = (turn: RecordedTurn) => {
    const task = processTurn(config, ctx, turn).catch((err) => {
      log.error(`turn ${turnLabel(turn)} failed`, err);
    });
    pendingTurns.add(task);
    void task.finally(() => pendingTurns.delete(task));
  };
  const segmenter = new TurnSegmenter(onTurnFinished);

  const onDiscussionFinished = (recording: RecordedDiscussion) => {
    const task = processDiscussion(config, ctx, recording).catch((err) =>
      log.error('discussion processor failed', err)
    );
    pendingDiscussion.add(task);
    void task.finally(() => pendingDiscussion.delete(task));
  };
  const discussionRecorder = new DiscussionRecorder(onDiscussionFinished);

  const metaByIdentity = new Map(meta.players.map((p) => [p.id, p.display_name]));

  const onRoundChanged = (quest: number, round: number) => {
    if (!guessTracker) return;
    const task = (async () => {
      // Wait for this round's turn pipelines to flush to disk, then re-guess.
      await Promise.allSettled(Array.from(pendingTurns));
      await guessTracker.updateForRound(quest, round);
    })().catch((err) => log.error(`guess-update Q${quest}/R${round} failed`, err));
    pendingGuesses.add(task);
    void task.finally(() => pendingGuesses.delete(task));
  };

  const timerListener = new TimerListener(
    segmenter,
    { displayName: (identity) => metaByIdentity.get(identity) ?? identity },
    undefined,
    onRoundChanged
  );
  const discussionListener = new DiscussionListener(
    discussionRecorder,
    (identity) => metaByIdentity.get(identity) ?? identity
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
      // Every audio frame goes to both the per-turn segmenter (which drops
      // frames that aren't from the active quest speaker) and the discussion
      // recorder (which buffers all participants when a discussion is active).
      // Outside of an active window both are cheap no-ops.
      onAudioFrame: (identity, data, sr) => {
        segmenter.onAudioFrame(identity, data, sr);
        discussionRecorder.onAudioFrame(identity, data, sr);
      },
      onTimerData: (payload) => timerListener.onPayload(payload),
      onDiscussionTimerData: (payload) => discussionListener.onPayload(payload),
    }
  );

  timerListener.setResolver({
    displayName: (identity) =>
      bot.displayNameFor(identity) || metaByIdentity.get(identity) || identity,
  });
  discussionListener.setResolver(
    (identity) => bot.displayNameFor(identity) || metaByIdentity.get(identity) || identity
  );

  await bot.join();
  log.info('bot joined LiveKit room');

  return {
    ctx,
    bot,
    segmenter,
    timerListener,
    discussionRecorder,
    discussionListener,
    pendingTurns,
    pendingDiscussion,
    guessTracker,
    pendingGuesses,
  };
}

async function endSession(db: SupabaseClient, session: Session): Promise<void> {
  const { ctx } = session;
  const { log } = ctx;
  log.info('ending session');

  // Flush any in-flight turn — finalize() clears the active speaker which
  // triggers onTurnFinished → pipeline adds to pendingTurns.
  session.timerListener.finalize();

  // Flush any in-flight discussion recording (e.g., manager never broadcasted
  // the stop, or the session ended mid-discussion).
  session.discussionListener.finalize();

  if (session.pendingTurns.size > 0) {
    log.info(`waiting for ${session.pendingTurns.size} pending turn pipeline(s)`);
    await Promise.allSettled(Array.from(session.pendingTurns));
  }
  if (session.pendingDiscussion.size > 0) {
    log.info(
      `waiting for ${session.pendingDiscussion.size} pending discussion pipeline(s)`
    );
    await Promise.allSettled(Array.from(session.pendingDiscussion));
  }

  // Blind mode: drain in-flight per-round guess-updates, then add the FINAL round
  // (the one in progress at end-of-game that never triggered onRoundChanged).
  if (session.guessTracker) {
    if (session.pendingGuesses.size > 0) {
      log.info(`waiting for ${session.pendingGuesses.size} pending guess-update(s)`);
      await Promise.allSettled(Array.from(session.pendingGuesses));
    }
    const finalQuest = session.timerListener.getLastSeenQuest();
    if (finalQuest > 0) {
      const finalRound = session.timerListener.getCurrentRoundIndex();
      try {
        await session.guessTracker.updateForRound(finalQuest, finalRound);
      } catch (err) {
        log.error('final guess-update failed', err);
      }
    }
  }

  // Leave LiveKit as soon as recording is fully wrapped up — no reason to
  // stay connected during LLM work.
  await session.bot.leave().catch((err) => log.error('bot.leave failed', err));

  // The game record — every fact of the game, from the database and the turn
  // files — then the final report from it: Persian, checked, then translated.
  try {
    await updateGameReview(db, ctx.gameId, { status: 'generating' });
    const record = await writeGameRecord(ctx, dbRecordSource(db, ctx.gameId));
    log.info('game record written');
    const { faPath, enPath } = await generateFinalReport(ctx, record, session.guessTracker);
    await updateGameReview(db, ctx.gameId, {
      status: 'ready',
      summary_fa_path: faPath,
      // Null when the translation failed: the report is Persian only.
      summary_en_path: enPath,
      error_message: null,
    });
    log.info(enPath ? 'final report generated' : 'final report generated, in Persian only');
  } catch (err) {
    log.error('final report generation failed', err);
    await updateGameReview(db, ctx.gameId, {
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
    }).catch((updateErr) => log.error('failed to mark review as failed', updateErr));
  }

  log.info('session closed');
}

/** What a stale review's page says, by the status it was left in. */
const STALE_REVIEW_ERROR: Record<StaleReview['status'], string> = {
  generating: 'The reviewer stopped while writing this report, so the report was never finished.',
  recording:
    'The reviewer stopped while recording this game, so it missed the rest of the game and wrote no report.',
};

/**
 * On boot, before the watcher starts and so before any session of this
 * process: every review a stopped reviewer left unfinished — killed while
 * writing its report (`generating`), or while recording a game that is over
 * by now (`recording`) — is marked failed, so its page stops waiting. No
 * report is regenerated: a `recording` review missed the end of its game,
 * and a `generating` one would need a second way into the report (meta.json
 * and, in blind mode, the detective's reads from guess_log.json, which
 * nothing reads back) for a case the stop grace period makes rare. The
 * reviewer is the only writer of game_reviews, one instance per database.
 */
async function failStaleReviews(db: SupabaseClient): Promise<void> {
  for (const review of await findStaleReviews(db)) {
    console.log(`[agent] review of game ${review.gameId} was left ${review.status}; marking it failed`);
    await updateGameReview(db, review.gameId, {
      status: 'failed',
      error_message: STALE_REVIEW_ERROR[review.status],
    });
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log('[agent] booting; data dir:', config.storage.dataDir);

  const db = createDbClient(config.supabase.url, config.supabase.serviceRoleKey);
  const llm = createPipelineLlm(config);
  // A failure here must not keep the reviewer from the next game.
  await failStaleReviews(db).catch((err) =>
    console.error('[agent] could not fail the stale reviews:', err)
  );
  let session: Session | null = null;
  // Sessions still wrapping up (final report), awaited on shutdown.
  const ending = new Set<Promise<void>>();

  const watcher = startWatcher(db, config.polling.gameWatcherMs, {
    onGameStart: async (game) => {
      session = await startSession(config, db, llm, game);
    },
    onGameEnd: (_gameId) => {
      if (!session) return;
      const s = session;
      session = null;
      // Wrap up in the background so the watcher can join the next game
      // right away instead of waiting on final-report generation.
      const task = endSession(db, s).catch((err) => {
        console.error('[agent] endSession failed:', err);
      });
      ending.add(task);
      void task.finally(() => ending.delete(task));
    },
  });

  // Docker allows this stop_grace_period (docker-compose.yml) before SIGKILL:
  // long enough for a final report. A report cut off by SIGKILL is left
  // `generating`, and failed on the next boot.
  const shutdown = async (signal: string) => {
    console.log(`[agent] received ${signal}, shutting down`);
    watcher.stop();
    if (session) await endSession(db, session).catch(() => {});
    await Promise.allSettled(Array.from(ending));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
