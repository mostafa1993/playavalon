/**
 * API Route: /api/reviews/[gameId]/chat
 * Each player's private chat with the AI reviewer about a finished game.
 *
 *   GET  — the caller's thread, and how many questions a player may ask.
 *   POST — { question }: the reviewer's answer, streamed as plain text.
 *
 * Both answer only when, in this order: the caller is signed in (401); the
 * game exists (404); they played it, by its seating order (403); it is over,
 * so every role is already shown (409); the app has a model, its review is
 * ready, and the reviewer left its record and Persian report in the game's
 * folder in DATA_DIR (404 "Chat isn't available for this game"). POST then
 * refuses a question past the limit (429).
 *
 * A question is stored, with the next number in the thread, before the model
 * is called; the table refuses a second question with the same number, so
 * questions sent at once can't pass the limit. If no text of the answer comes
 * — the model can't be reached, or gives nothing — the question is removed
 * again and isn't counted (502). Once text has come, the question counts
 * whatever happens next. The model gets the whole record, everyone's true
 * role, the report and the thread, and its answer is stored under the
 * question's number once whole, even if the player has left.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { getRoleAssignments } from '@/lib/supabase/roles';
import { playedInGame } from '@/lib/domain/game-membership';
import { validateUUID } from '@/lib/domain/validation';
import { summaryView, type ReviewView } from '@/lib/review/summary-view';
import { readGameRecord, readSummaryFile, reviewDataDir } from '@/lib/review-chat/files';
import {
  deleteMessage,
  getReview,
  getThread,
  questionLimit,
  storeMessage,
} from '@/lib/review-chat/store';
import { buildChatPrompt } from '@/lib/review-chat/prompt';
import { modelConfigured, streamAnswer } from '@/lib/review-chat/model';
import type { ChatRole } from '@/lib/review-chat/record-text';
import { ERROR_CODES } from '@/lib/utils/constants';
import { errorResponse, errors, handleError } from '@/lib/utils/errors';
import type { Game } from '@/types/game';
import type { ReviewChatThreadResponse, ReviewGameRecord } from '@/types/review';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

const MAX_QUESTION_LENGTH = 1000;

const notAvailable = () =>
  errorResponse(ERROR_CODES.NOT_FOUND, "Chat isn't available for this game", 404);

interface Chat {
  client: SupabaseClient;
  playerId: string;
  game: Game;
  record: ReviewGameRecord;
  report: ReviewView;
}

/** The caller's chat about this game, or the response refusing it. */
async function openChat(gameId: string): Promise<Chat | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return errors.unauthorized();

  if (!validateUUID(gameId).valid) return errors.notFound('Game');
  const client = createServiceClient();
  const game = await getGameById(client, gameId);
  if (!game) return errors.notFound('Game');
  if (!playedInGame(game, user.id)) return errors.notInGame();
  // A review can be ready for a game still in play or abandoned, whose roles
  // were never shown.
  if (game.phase !== 'game_over') return errors.gameNotOver();

  if (!modelConfigured()) return notAvailable();
  const review = await getReview(client, game.id);
  if (review?.status !== 'ready' || !review.summary_fa_path) return notAvailable();

  const dataDir = reviewDataDir();
  const record = await readGameRecord(dataDir, game.id);
  if (!record) return notAvailable();
  const report = summaryView(await readSummaryFile(dataDir, game.id, review.summary_fa_path));
  if (!report) return notAvailable();

  return { client, playerId: user.id, game, record, report };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;
    const chat = await openChat(gameId);
    if (chat instanceof NextResponse) return chat;

    const messages = await getThread(chat.client, chat.game.id, chat.playerId);
    const body: ReviewChatThreadResponse = { data: { limit: questionLimit(), messages } };
    return NextResponse.json(body);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;
    const chat = await openChat(gameId);
    if (chat instanceof NextResponse) return chat;
    const { client, playerId, game, record, report } = chat;

    const body = await request.json().catch(() => null);
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > MAX_QUESTION_LENGTH) {
      return errors.invalidRequest(`Ask a question of 1 to ${MAX_QUESTION_LENGTH} characters`);
    }

    // Every stored question counts, answered or not.
    const thread = await getThread(client, game.id, playerId);
    const asked = thread.filter((m) => m.speaker === 'player').length;
    const limit = questionLimit();
    if (asked >= limit) {
      return errorResponse(
        ERROR_CODES.QUESTION_LIMIT_REACHED,
        `You've reached the ${limit}-question limit for this game`,
        429
      );
    }

    // A god record holds the roles; a blind one never does, and the chat is
    // told them from the game's role rows.
    const roles: ChatRole[] =
      record.mode === 'god'
        ? record.players
        : (await getRoleAssignments(client, game.room_id)).map((r) => ({
            id: r.player_id,
            role: r.role,
            special_role: r.special_role,
          }));
    const prompt = buildChatPrompt({ record, roles, report, askerId: playerId, thread, question });

    const turn = { gameId: game.id, playerId, turnNo: asked + 1 };
    if (!(await storeMessage(client, { ...turn, speaker: 'player', content: question }))) {
      return errorResponse(ERROR_CODES.QUESTION_IN_PROGRESS, 'Only one question at a time', 429);
    }

    let chunks: AsyncIterator<string>;
    let first: string;
    try {
      chunks = (await streamAnswer(prompt))[Symbol.asyncIterator]();
      const next = await chunks.next();
      if (next.done) throw new Error('The answer ended before any text');
      first = next.value;
    } catch (err) {
      console.error('[review-chat] no answer came:', err);
      // Nothing reached the player, so the question isn't counted.
      await deleteMessage(client, { ...turn, speaker: 'player' });
      return errorResponse(
        ERROR_CODES.REVIEWER_UNAVAILABLE,
        "The reviewer couldn't answer. Try again.",
        502
      );
    }

    const answer = answerStream(first, chunks, (content) =>
      storeMessage(client, { ...turn, speaker: 'reviewer', content })
    );
    return new Response(answer, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * The answer's text — its first piece, then the rest as it comes — stored
 * once whole. It is read to its end even after the player has gone, so the
 * thread keeps it; a failure ends the stream with an error and stores no
 * answer.
 */
function answerStream(
  first: string,
  rest: AsyncIterator<string>,
  store: (answer: string) => Promise<unknown>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let listening = true;
  return new ReadableStream({
    start(controller) {
      void (async () => {
        let answer = first;
        try {
          controller.enqueue(encoder.encode(first));
          for (let next = await rest.next(); !next.done; next = await rest.next()) {
            answer += next.value;
            if (listening) controller.enqueue(encoder.encode(next.value));
          }
          await store(answer);
          if (listening) controller.close();
        } catch (err) {
          console.error('[review-chat] the answer failed:', err);
          if (listening) controller.error(err);
        }
      })();
    },
    cancel() {
      listening = false;
    },
  });
}
