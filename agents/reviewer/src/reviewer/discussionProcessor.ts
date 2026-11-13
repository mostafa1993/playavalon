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
 * Steps 3–4 are `finishSpeaker`; the replay runs them alone on a discussion's
 * stored transcripts (`processRawDiscussion`).
 *
 * Every step fails-soft: an error on one speaker's clip doesn't block the
 * others, and a full processing failure produces no file at all (the final
 * narrative loader treats "no discussion.json" as "no discussion happened",
 * which is correct).
 */

import type { AgentConfig } from '../config.js';
import type { PipelineContext } from '../pipeline.js';
import { transcribe } from '@avalon/shared';
import { isSilent } from '@avalon/shared';
import { writeJsonAtomic } from '../storage/atomicWrite.js';
import { discussionPath } from '../storage/layout.js';
import { correctTranscript } from './transcriptCorrector.js';
import { summarizeTurn } from './turnSummarizer.js';
import type {
  DiscussionJson,
  DiscussionSpeakerRecord,
  GameMetaSnapshot,
  RawDiscussionJson,
  RawDiscussionSpeaker,
  TurnSummary,
} from '../types.js';
import type { RecordedDiscussion } from '../bot/discussionRecorder.js';

function buildSeatTable(meta: GameMetaSnapshot): string {
  return meta.players
    .filter((p) => p.seat_number !== null)
    .sort((a, b) => (a.seat_number ?? 0) - (b.seat_number ?? 0))
    .map((p) => `seat ${p.seat_number}: ${p.display_name}`)
    .join('\n');
}

/** Silence check + STT. A silent clip or a failed STT gives an empty transcript. */
async function transcribeSpeaker(
  config: AgentConfig,
  ctx: PipelineContext,
  seg: RecordedDiscussion['speakers'][number]
): Promise<RawDiscussionSpeaker> {
  const base: RawDiscussionSpeaker = {
    identity: seg.identity,
    display_name: seg.displayName,
    durationSec: Number(seg.durationSec.toFixed(2)),
    sampleRate: seg.sampleRate,
    transcript_raw: '',
    confidence: null,
  };

  if (isSilent(seg.pcm, config.audio.silenceRmsThreshold)) return base;

  try {
    const res = await transcribe(
      {
        key: config.azureSpeech.key,
        region: config.azureSpeech.region,
        language: config.azureSpeech.language,
      },
      seg.pcm,
      seg.sampleRate,
      {
        retry: { maxAttempts: config.retry.maxAttempts, baseDelayMs: config.retry.baseDelayMs },
        silenceRmsThreshold: config.audio.silenceRmsThreshold,
      }
    );
    return { ...base, transcript_raw: res.transcript, confidence: res.confidence };
  } catch (err) {
    ctx.log.error(`discussion STT failed for ${seg.displayName}`, err);
    return base;
  }
}

/** Correction + summary for one speaker's transcribed clip. */
async function finishSpeaker(
  ctx: PipelineContext,
  raw: RawDiscussionSpeaker,
  leaderDisplayName: string
): Promise<DiscussionSpeakerRecord> {
  const { llm, meta } = ctx;

  let transcript = raw.transcript_raw;
  let corrected = false;
  if (ctx.correction && raw.transcript_raw.trim().length > 0) {
    try {
      transcript = await correctTranscript(llm, raw.transcript_raw);
      corrected = true;
    } catch (err) {
      ctx.log.error(`discussion correction failed for ${raw.display_name}, using raw STT`, err);
    }
  }

  let summary: TurnSummary | undefined;
  if (transcript.trim().length > 0) {
    try {
      summary = await summarizeTurn(llm, {
        // The assassin phase has no proposal/leader context; pass 0 and
        // 'unknown' so the summarizer doesn't try to interpret them.
        questNumber: 0,
        roundIndex: 0,
        turnIndex: 0,
        speakerDisplayName: raw.display_name,
        speakerSeat: meta.players.find((p) => p.id === raw.identity)?.seat_number ?? null,
        leaderDisplayName,
        proposedTeam: 'assassin phase — no team',
        seatTable: buildSeatTable(meta),
        transcript,
      });
    } catch (err) {
      ctx.log.error(`discussion summarizer failed for ${raw.display_name}`, err);
    }
  }

  return {
    identity: raw.identity,
    display_name: raw.display_name,
    durationSec: raw.durationSec,
    sampleRate: raw.sampleRate,
    transcript,
    transcript_raw: raw.transcript_raw,
    transcript_corrected: corrected,
    confidence: raw.confidence,
    summary,
  };
}

function assassinOf(ctx: PipelineContext, assassinIdentity: string | null) {
  return assassinIdentity ? ctx.meta.players.find((p) => p.id === assassinIdentity) : null;
}

async function writeDiscussion(
  ctx: PipelineContext,
  head: Omit<RawDiscussionJson, 'gameId' | 'speakers'>,
  speakers: DiscussionSpeakerRecord[]
): Promise<void> {
  const out: DiscussionJson = {
    gameId: ctx.gameId,
    startedAt: head.startedAt,
    durationSec: head.durationSec,
    assassinIdentity: head.assassinIdentity,
    assassinDisplayName: assassinOf(ctx, head.assassinIdentity)?.display_name ?? null,
    speakers,
  };

  await writeJsonAtomic(discussionPath(ctx.dir), out);
  ctx.log.info('discussion.json written');
}

/** Live: every speaker's clip through STT, then correction and summary. */
export async function processDiscussion(
  config: AgentConfig,
  ctx: PipelineContext,
  recording: RecordedDiscussion
): Promise<void> {
  ctx.log.info(
    `processing discussion: ${recording.speakers.length} speaker(s), ${recording.durationSec}s window`
  );

  const leaderDisplayName =
    assassinOf(ctx, recording.assassinIdentity)?.display_name ?? 'the assassin';

  const speakers = await Promise.all(
    recording.speakers.map(async (seg) =>
      finishSpeaker(ctx, await transcribeSpeaker(config, ctx, seg), leaderDisplayName)
    )
  );

  await writeDiscussion(
    ctx,
    {
      startedAt: recording.startedAt.toISOString(),
      durationSec: recording.durationSec,
      assassinIdentity: recording.assassinIdentity,
    },
    speakers
  );
}

/** Replay: correction and summary on a discussion's stored transcripts. */
export async function processRawDiscussion(
  ctx: PipelineContext,
  raw: RawDiscussionJson
): Promise<void> {
  ctx.log.info(
    `processing discussion: ${raw.speakers.length} speaker(s), ${raw.durationSec}s window`
  );

  const leaderDisplayName = assassinOf(ctx, raw.assassinIdentity)?.display_name ?? 'the assassin';

  const speakers = await Promise.all(
    raw.speakers.map((speaker) => finishSpeaker(ctx, speaker, leaderDisplayName))
  );

  await writeDiscussion(ctx, raw, speakers);
}
