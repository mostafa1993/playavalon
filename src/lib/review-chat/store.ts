/**
 * The chat's rows: the game's review (`game_reviews`) and each player's
 * thread (`review_chat_messages`, 031), read and written with the service
 * role only.
 *
 * A question takes the next number in its thread and its answer the same one.
 * The table refuses a second question with a number already taken, so of two
 * questions sent at once only one is stored.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewChatMessage, ReviewStatus } from '@/types/review';

const UNIQUE_VIOLATION = '23505';

/** How many questions a player may ask about one game. */
export function questionLimit(): number {
  const limit = Number(process.env.REVIEW_CHAT_MAX_QUESTIONS ?? 30);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`REVIEW_CHAT_MAX_QUESTIONS must be a positive integer, not ${limit}`);
  }
  return limit;
}

export async function getReview(
  client: SupabaseClient,
  gameId: string
): Promise<{ status: ReviewStatus; summary_fa_path: string | null } | null> {
  const { data, error } = await client
    .from('game_reviews')
    .select('status, summary_fa_path')
    .eq('game_id', gameId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The player's thread, oldest first: each question before its answer. */
export async function getThread(
  client: SupabaseClient,
  gameId: string,
  playerId: string
): Promise<ReviewChatMessage[]> {
  const { data, error } = await client
    .from('review_chat_messages')
    .select('turn_no, speaker, content, created_at')
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .order('turn_no')
    // 'player' sorts before 'reviewer': the question, then its answer.
    .order('speaker');
  if (error) throw error;
  return (data ?? []).map((m) => ({
    turnNo: m.turn_no,
    speaker: m.speaker,
    content: m.content,
    createdAt: m.created_at,
  }));
}

/** Stores one message; false when its number is already taken. */
export async function storeMessage(
  client: SupabaseClient,
  message: {
    gameId: string;
    playerId: string;
    turnNo: number;
    speaker: ReviewChatMessage['speaker'];
    content: string;
  }
): Promise<boolean> {
  const { error } = await client.from('review_chat_messages').insert({
    game_id: message.gameId,
    player_id: message.playerId,
    turn_no: message.turnNo,
    speaker: message.speaker,
    content: message.content,
  });
  if (error?.code === UNIQUE_VIOLATION) return false;
  if (error) throw error;
  return true;
}

/** Removes one message: a question no answer was given to, so it doesn't
 *  count. It is the thread's last, so the numbers stay contiguous. */
export async function deleteMessage(
  client: SupabaseClient,
  message: {
    gameId: string;
    playerId: string;
    turnNo: number;
    speaker: ReviewChatMessage['speaker'];
  }
): Promise<void> {
  const { error } = await client
    .from('review_chat_messages')
    .delete()
    .eq('game_id', message.gameId)
    .eq('player_id', message.playerId)
    .eq('turn_no', message.turnNo)
    .eq('speaker', message.speaker);
  if (error) throw error;
}
