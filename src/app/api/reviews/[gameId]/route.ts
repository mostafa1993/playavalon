/**
 * API Route: GET /api/reviews/[gameId]
 * Returns the AI game review status and, when ready, the full summary JSON
 * for the requested language (default: fa).
 *
 * Auth: caller must have played this game (be in its seating order).
 *
 * Only once the game can't be played any more: its phase is game_over, or its
 * room is closed (the game ended, the last human left, or the room outlived
 * its lifetime). A god-mode report shows every role, and the reviewer can
 * mark a review ready while the game is still live — when it is stopped, or
 * when a newer game starts — so a live game's report is refused (409).
 *
 * The summary files live on a shared Docker volume (`game_reviews_data`)
 * mounted read-only at /data/games on the app container. The agent writes
 * them; we only read.
 */

import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { getGameById } from '@/lib/supabase/games';
import { findRoomById } from '@/lib/supabase/rooms';
import { playedInGame } from '@/lib/domain/game-membership';
import { validateUUID } from '@/lib/domain/validation';
import { errors, handleError } from '@/lib/utils/errors';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

const DATA_DIR = process.env.DATA_DIR ?? '/data/games';

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) return errors.unauthorized();

    const url = new URL(request.url);
    const langParam = url.searchParams.get('lang') ?? 'fa';
    const language: 'fa' | 'en' = langParam === 'en' ? 'en' : 'fa';

    if (!validateUUID(gameId).valid) return errors.notFound('Game');
    const supabase = createServiceClient();

    const game = await getGameById(supabase, gameId);
    if (!game) return errors.notFound('Game');

    // The caller must have played this game. Room membership is not used: it
    // is cleared when a player creates another room.
    if (!playedInGame(game, user.id)) return errors.notInGame();

    if (game.phase !== 'game_over') {
      const room = await findRoomById(supabase, game.room_id);
      if (room?.status !== 'closed') return errors.gameNotOver();
    }

    const { data: review, error: reviewErr } = await supabase
      .from('game_reviews')
      .select('status, summary_fa_path, summary_en_path, error_message, updated_at')
      .eq('game_id', gameId)
      .maybeSingle();
    if (reviewErr) throw reviewErr;

    if (!review) {
      // No review row means AI review wasn't enabled for this game.
      return NextResponse.json({
        data: { enabled: false, status: null },
      });
    }

    const status = review.status as
      | 'pending'
      | 'recording'
      | 'generating'
      | 'ready'
      | 'failed';

    if (status !== 'ready') {
      return NextResponse.json({
        data: {
          enabled: true,
          status,
          error_message: review.error_message,
          updated_at: review.updated_at,
        },
      });
    }

    // Status is ready — read the requested-language summary from disk.
    const summaryPath =
      language === 'fa' ? review.summary_fa_path : review.summary_en_path;

    if (!summaryPath) {
      return NextResponse.json({
        data: {
          enabled: true,
          status: 'failed',
          error_message: `Summary path missing for language ${language}`,
        },
      });
    }

    // Defense-in-depth: confine the read to the configured data directory.
    const resolved = path.resolve(summaryPath);
    const rootResolved = path.resolve(DATA_DIR);
    if (!resolved.startsWith(rootResolved + path.sep)) {
      return errors.internalError('Review path outside allowed root');
    }

    let body: unknown;
    try {
      const raw = await fs.readFile(resolved, 'utf8');
      body = JSON.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({
          data: {
            enabled: true,
            status: 'failed',
            error_message: 'Summary file missing on disk',
          },
        });
      }
      throw err;
    }

    return NextResponse.json({
      data: {
        enabled: true,
        status: 'ready',
        language,
        summary: body,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
