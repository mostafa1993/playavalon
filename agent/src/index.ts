/**
 * Entrypoint for the AI reviewer agent.
 *
 * Lifecycle:
 *   1. Watcher polls Supabase for an active game with AI review enabled.
 *   2. On start: agent upserts `game_reviews` row (status='recording'),
 *      writes meta.json, joins the LiveKit room as a hidden bot,
 *      and begins buffering + transcribing turns.
 *   3. On end: agent leaves the room and disposes the session.
 *
 * Single concurrent game is assumed by product decision.
 */

import { loadConfig, type AgentConfig } from './config.js';
import { createDbClient, insertGameReviewRecording, loadMetaSnapshot } from './gamestate/db.js';
import { startWatcher } from './gamestate/watcher.js';
import type { ActiveGameRow } from './gamestate/db.js';
import { LiveKitBot } from './bot/livekitBot.js';
import { TurnSegmenter } from './bot/turnSegmenter.js';
import { TimerListener } from './bot/timerListener.js';
import { transcribe } from './stt/azureSpeech.js';
import { writeJsonAtomic } from './storage/atomicWrite.js';
import { metaPath, turnPath } from './storage/layout.js';
import type { MetaJson, RecordedTurn, TurnJson } from './types.js';

interface Session {
  gameId: string;
  roomCode: string;
  bot: LiveKitBot;
  segmenter: TurnSegmenter;
  timerListener: TimerListener;
  pendingTurns: Set<Promise<void>>;
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

async function startSession(
  config: AgentConfig,
  db: ReturnType<typeof createDbClient>,
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

  // 3. Set up segmenter, timer listener, then bot (note the order:
  // the bot constructor captures the timerListener/segmenter references).
  const pendingTurns = new Set<Promise<void>>();
  const onTurnFinished = (turn: RecordedTurn) => {
    const task = processTurn(config, game.id, turn).catch((err) => {
      log.error(`turn Q${turn.questNumber}/${turn.turnIndex} failed`, err);
    });
    pendingTurns.add(task);
    void task.finally(() => pendingTurns.delete(task));
  };
  const segmenter = new TurnSegmenter(onTurnFinished);

  const metaByIdentity = new Map(meta.players.map((p) => [p.id, p.display_name]));
  // Temporary resolver used until bot is constructed; replaced via `setResolver`
  // after the bot exists so both the timer listener and the bot can see each
  // other without a temporal-dead-zone closure.
  const timerListener = new TimerListener(segmenter, {
    displayName: (identity) => metaByIdentity.get(identity) ?? identity,
  });

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

  // Upgrade the resolver now that the bot (and its identity→name map) exists.
  timerListener.setResolver({
    displayName: (identity) =>
      bot.displayNameFor(identity) || metaByIdentity.get(identity) || identity,
  });

  await bot.join();
  log.info('bot joined LiveKit room');

  return {
    gameId: game.id,
    roomCode: game.room_code,
    bot,
    segmenter,
    timerListener,
    pendingTurns,
  };
}

async function endSession(_config: AgentConfig, session: Session): Promise<void> {
  const log = buildSessionLogger(session.gameId);
  log.info('ending session');

  // Flush any in-flight turn (if a speaker was still active when the game
  // ended). finalize() calls clearActiveSpeaker() which triggers onTurnFinished.
  session.timerListener.finalize();

  if (session.pendingTurns.size > 0) {
    log.info(`waiting for ${session.pendingTurns.size} pending transcript(s)`);
    await Promise.allSettled(Array.from(session.pendingTurns));
  }

  await session.bot.leave().catch((err) => log.error('bot.leave failed', err));
  log.info('session closed');
}

async function processTurn(
  config: AgentConfig,
  gameId: string,
  turn: RecordedTurn
): Promise<void> {
  const log = buildSessionLogger(gameId);
  log.info(
    `turn Q${turn.questNumber}/${turn.turnIndex} speaker=${turn.speakerDisplayName} (${turn.durationSec.toFixed(1)}s)`
  );

  const { transcript, confidence } = await transcribe(
    {
      key: config.azureSpeech.key,
      region: config.azureSpeech.region,
      language: config.azureSpeech.language,
    },
    turn.pcm,
    turn.sampleRate
  );

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
  };

  await writeJsonAtomic(
    turnPath(config.storage.dataDir, gameId, turn.questNumber, turn.turnIndex),
    out
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log('[agent] booting; data dir:', config.storage.dataDir);

  const db = createDbClient(config.supabase.url, config.supabase.serviceRoleKey);
  let session: Session | null = null;

  const watcher = startWatcher(db, config.polling.gameWatcherMs, {
    onGameStart: async (game) => {
      // Single-concurrent assumption; the watcher guarantees this is only
      // called when no game is currently tracked. If an exception escapes,
      // the watcher rolls back currentGameId and retries on the next tick.
      session = await startSession(config, db, game);
    },
    onGameEnd: async (_gameId) => {
      if (!session) return;
      const s = session;
      session = null;
      await endSession(config, s);
    },
  });

  const shutdown = async (signal: string) => {
    console.log(`[agent] received ${signal}, shutting down`);
    watcher.stop();
    if (session) await endSession(config, session).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
