/**
 * Turn summarizer — per-turn LLM call.
 *
 * Input: completed turn with transcript + context.
 * Output: structured TurnSummary (key_points, claims, suspicions, etc.).
 */

import type { LLMClient } from './llm.js';
import type { TurnSummary } from '../types.js';

export interface TurnSummarizerContext {
  questNumber: number;
  turnIndex: number;
  speakerDisplayName: string;
  speakerSeat: number | null;
  leaderDisplayName: string;
  proposedTeam: string;        // comma-separated display names
  seatTable: string;           // preformatted "seat N: displayName"
  transcript: string;          // Persian
}

export async function summarizeTurn(
  llm: LLMClient,
  ctx: TurnSummarizerContext
): Promise<TurnSummary> {
  return llm.runJson<TurnSummary>('turn-summarizer.yml', {
    quest_number: ctx.questNumber,
    turn_index: ctx.turnIndex,
    speaker_display_name: ctx.speakerDisplayName,
    speaker_seat: ctx.speakerSeat,
    leader_display_name: ctx.leaderDisplayName,
    proposed_team: ctx.proposedTeam,
    seat_table: ctx.seatTable,
    transcript: ctx.transcript,
  });
}
