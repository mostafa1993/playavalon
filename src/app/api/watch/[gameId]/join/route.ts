/**
 * API Route: POST /api/watch/[gameId]/join
 * Join a game as a watcher (spectator)
 *
 * Feature 015: Watcher Mode
 * - Validates game exists and has started
 * - Checks 10-watcher limit
 * - Adds watcher to in-memory session store
 * - Does NOT write to any game database tables (per NFR-004)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, createServiceClient } from '@/lib/supabase/server';
import { findPlayerById } from '@/lib/supabase/players';
import { getGameById } from '@/lib/supabase/games';
import {
  addWatcher,
  getWatcherCount,
  isWatcherLimitReached,
} from '@/lib/domain/watcher-session';
import { MAX_WATCHERS_PER_GAME } from '@/types/watcher';
import type { JoinWatchResponse, WatcherError } from '@/types/watcher';

interface RouteParams {
  params: Promise<{ gameId: string }>;
}

/**
 * POST /api/watch/[gameId]/join
 * Join as a watcher for a game
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { gameId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      const error: WatcherError = {
        code: 'UNAUTHORIZED',
        message: 'You must be logged in to watch games',
      };
      return NextResponse.json({ error }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Get player profile for display name
    const player = await findPlayerById(supabase, user.id);
    if (!player) {
      const error: WatcherError = {
        code: 'UNAUTHORIZED',
        message: 'Player profile not found',
      };
      return NextResponse.json({ error }, { status: 401 });
    }

    // Get game (READ ONLY - no writes)
    const game = await getGameById(supabase, gameId);
    if (!game) {
      const error: WatcherError = {
        code: 'GAME_NOT_FOUND',
        message: 'Game not found',
      };
      return NextResponse.json({ error }, { status: 404 });
    }

    // Check watcher limit (FR-004: max 10 watchers)
    if (isWatcherLimitReached(gameId)) {
      const error: WatcherError = {
        code: 'WATCHER_LIMIT_REACHED',
        message: `This game has reached the maximum number of spectators (${MAX_WATCHERS_PER_GAME})`,
      };
      return NextResponse.json({ error }, { status: 403 });
    }

    // Add watcher to in-memory session
    const added = addWatcher(gameId, user.id, player.display_name);

    if (!added) {
      const error: WatcherError = {
        code: 'WATCHER_LIMIT_REACHED',
        message: `This game has reached the maximum number of spectators (${MAX_WATCHERS_PER_GAME})`,
      };
      return NextResponse.json({ error }, { status: 403 });
    }

    const response: JoinWatchResponse = {
      success: true,
      gameId,
      watcherCount: getWatcherCount(gameId),
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error('[Watch Join Error]', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to join as watcher' } },
      { status: 500 }
    );
  }
}
