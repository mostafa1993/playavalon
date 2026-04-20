/**
 * Discussion processor — runs when the DiscussionRecorder flushes a
 * RecordedDiscussion object. For each speaker's audio clip:
 *   1. silence check,
 *   2. STT,
 *   3. correction (optional, config-gated),
 *   4. per-speaker summary (reuses the turn summarizer prompt — the shape
 *      of analysis we want is the same: key points, claims, quotes),
 * then writes a single discussion.json at the game's directory root.
 *
 * Every step fails-soft: an error on one speaker's clip doesn't block the
 * others, and a full processing failure produces no file at all (the final
 * narrative loader treats "no discussion.json" as "no discussion happened",
 * which is correct).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from '../config.js';
import { transcribe } from '../stt/azureSpeech.js';
import { isSilent } from '../stt/silence.js';
import { writeJsonAtomic } from '../storage/atomicWrite.js';
import { discussionPath } from '../storage/layout.js';
import type { LLMClient } from './llm.js';
import { correctTranscript } from './transcriptCorrector.js';
import { summarizeTurn } from './turnSummarizer.js';
import type {
  DiscussionJson,
  DiscussionSpeakerRecord,
  GameMetaSnapshot,
  TurnSummary,
} from '../types.js';
import type { RecordedDiscussion } from '../bot/discussionRecorder.js';

export interface DiscussionProcessorContext {
  config: AgentConfig;
  db: SupabaseClient;
  llm: LLMClient;
  gameId: string;
  meta: GameMetaSnapshot;
}

function buildSeatTable(meta: GameMetaSnapshot): string {
  return meta.players
    .filter((p) => p.seat_number !== null)
    .sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0))
    .map((p) => `seat ${p.seat_number}: ${p.display_name}`)
    .join('\n');
}

async function processSpeaker(
  ctx: DiscussionProcessorContext,
  log: (msg: string, err?: unknown) => void,
  seg: RecordedDiscussion['speakers'][number],
  leaderDisplayName: string
): Promise<DiscussionSpeakerRecord> {
  const { config, llm, meta } = ctx;

  const speakerMeta = meta.players.find((p) => p.id === seg.identity);
  const seatTable = buildSeatTable(meta);

  const silent = isSilent(seg.pcm, config.audio.silenceRmsThreshold);
  const base: DiscussionSpeakerRecord = {
    identity: seg.identity,
    display_name: seg.displayName,
    durationSec: Number(seg.durationSec.toFixed(2)),
    sampleRate: seg.sampleRate,
    transcript: '',
    transcript_raw: '',
    transcript_corrected: false,
    confidence: null,
  };

  if (silent) return base;

  // STT
  let transcriptRaw = '';
  let confidence: number | null = null;
  try {
    const res = await transcribe(
      {
        key: config.azureSpeech.key,
        region: config.azureSpeech.region,
        language: config.azureSpeech.language,
      },
      seg.pcm,
      seg.sampleRate,
      { retry: { maxAttempts: config.retry.maxAttempts, baseDelayMs: config.retry.baseDelayMs } }
    );
    transcriptRaw = res.transcript;
    confidence = res.confidence;
  } catch (err) {
    log(`discussion STT failed for ${seg.displayName}`, err);
    return base;
  }

  let transcript = transcriptRaw;
  let corrected = false;
  if (config.correction.enabled && transcriptRaw.trim().length > 0) {
    try {
      transcript = await correctTranscript(llm, transcriptRaw);
      corrected = true;
    } catch (err) {
      log(`discussion correction failed for ${seg.displayName}, using raw STT`, err);
    }
  }

  let summary: TurnSummary | undefined;
  if (transcript.trim().length > 0) {
    try {
      summary = await summarizeTurn(llm, {
        // The assassin phase has no proposal/leader context; pass 0 and
        // 'unknown' so the summarizer doesn't try to interpret them.
        questNumber: 0,
        turnIndex: 0,
        speakerDisplayName: seg.displayName,
        speakerSeat: speakerMeta?.seat_number ?? null,
        leaderDisplayName,
        proposedTeam: 'assassin phase — no team',
        seatTable,
        transcript,
      });
    } catch (err) {
      log(`discussion summarizer failed for ${seg.displayName}`, err);
    }
  }

  return {
    ...base,
    transcript,
    transcript_raw: transcriptRaw,
    transcript_corrected: corrected,
    confidence,
    summary,
  };
}

export async function processDiscussion(
  ctx: DiscussionProcessorContext,
  recording: RecordedDiscussion,
  log: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void }
): Promise<void> {
  log.info(
    `processing discussion: ${recording.speakers.length} speaker(s), ${recording.durationSec}s window`
  );

  const assassinMeta = recording.assassinIdentity
    ? ctx.meta.players.find((p) => p.id === recording.assassinIdentity)
    : null;
  const leaderDisplayName = assassinMeta?.display_name ?? 'the assassin';

  const speakers = await Promise.all(
    recording.speakers.map((seg) =>
      processSpeaker(
        ctx,
        (msg, err) => log.error(msg, err),
        seg,
        leaderDisplayName
      )
    )
  );

  const out: DiscussionJson = {
    gameId: ctx.gameId,
    startedAt: recording.startedAt.toISOString(),
    durationSec: recording.durationSec,
    assassinIdentity: recording.assassinIdentity,
    assassinDisplayName: assassinMeta?.display_name ?? null,
    speakers,
  };

  await writeJsonAtomic(discussionPath(ctx.config.storage.dataDir, ctx.gameId), out);
  log.info('discussion.json written');
}
